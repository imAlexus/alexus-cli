import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/sessions/sqlite-store.js";
import { runAgentLoop } from "../src/agent/agent-loop.js";
import { defaultConfig } from "../src/config/schema.js";
import { EventBus } from "../src/protocol/event-bus.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { z } from "zod";
import type { Provider, ProviderResponse } from "../src/providers/provider.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), "alexus-session-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true });
});

describe("thread, turn and item persistence", () => {
  it("round-trips complete assistant tool calls and tool results", async () => {
    const workspace = await root();
    const store = new SessionStore(workspace);
    const session = store.create({ model: "test/model", task: "fix", approvalMode: "workspace" });
    const turn = store.createTurn(session.id, "inspect");
    const assistant = {
      role: "assistant" as const,
      content: null,
      refusal: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function" as const,
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        },
      ],
    };
    const tool = { role: "tool" as const, tool_call_id: "call_1", content: '{"ok":true}' };
    store.addMessage(session.id, { role: "system", content: "system" }, turn.id);
    store.addMessage(session.id, assistant, turn.id);
    store.addMessage(session.id, tool, turn.id);
    store.recordItem(turn.id, "assistant_message", "completed", assistant);
    store.finishTurn(turn.id, "completed");
    store.close();

    const reopened = new SessionStore(workspace);
    expect(reopened.messages(session.id)).toEqual([
      { role: "system", content: "system" },
      assistant,
      tool,
    ]);
    expect(reopened.turns(session.id)).toMatchObject([
      { id: turn.id, prompt: "inspect", status: "completed" },
    ]);
    const items = reopened.db.prepare("SELECT type,status FROM items WHERE turn_id=?").all(turn.id);
    expect(items).toEqual([{ type: "assistant_message", status: "completed" }]);
    reopened.close();
  });

  it("reuses a completed tool call id without executing the tool again", async () => {
    const workspace = await root();
    const store = new SessionStore(workspace);
    const session = store.create({
      model: "test/model",
      task: "inspect",
      approvalMode: "workspace",
    });
    const previousTurn = store.createTurn(session.id, "previous");
    const { runId } = store.startTool(session.id, previousTurn.id, "call_same", "counted_tool", {});
    store.finishTool(runId, { success: true, result: { value: 1 } });
    store.finishTurn(previousTurn.id, "completed");
    const turn = store.createTurn(session.id, "resume");
    let executions = 0;
    const schema = z.object({}).strict();
    const tools = new ToolRegistry().register({
      name: "counted_tool",
      description: "test",
      schema,
      parameters: { type: "object", additionalProperties: false, properties: {} },
      execute() {
        executions++;
        return Promise.resolve({ value: 2 });
      },
    });
    const responses: ProviderResponse[] = [
      {
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "call_same",
              type: "function",
              function: { name: "counted_tool", arguments: "{}" },
            },
          ],
        },
        text: "",
        toolCalls: [{ id: "call_same", name: "counted_tool", arguments: "{}" }],
      },
      {
        message: { role: "assistant", content: "done", refusal: null },
        text: "done",
        toolCalls: [],
      },
    ];
    const provider: Provider = {
      generate() {
        const response = responses.shift();
        return response
          ? Promise.resolve(response)
          : Promise.reject(new Error("Unexpected provider call"));
      },
    };

    const result = await runAgentLoop({
      task: "resume",
      workspaceRoot: workspace,
      config: { ...defaultConfig, stream: false },
      provider,
      tools,
      store,
      session,
      turnId: turn.id,
      events: new EventBus(),
      signal: new AbortController().signal,
      json: true,
      resumeMessages: [],
    });

    expect(result.success).toBe(true);
    expect(executions).toBe(0);
    expect(store.messages(session.id)).toContainEqual(
      expect.objectContaining({ role: "tool", tool_call_id: "call_same" }),
    );
    store.close();
  });

  it("converts a running tool into a persisted interrupted result after a crash", async () => {
    const workspace = await root();
    const store = new SessionStore(workspace);
    const session = store.create({ model: "test/model", task: "fix", approvalMode: "workspace" });
    const turn = store.createTurn(session.id, "change file");
    store.addMessage(
      session.id,
      {
        role: "assistant",
        content: null,
        refusal: null,
        tool_calls: [
          {
            id: "call_crashed",
            type: "function",
            function: { name: "write_file", arguments: "{}" },
          },
        ],
      },
      turn.id,
    );
    store.startTool(session.id, turn.id, "call_crashed", "write_file", { path: "new.ts" });

    expect(store.recoverInterrupted(session.id)).toBe(1);
    store.db.prepare("DELETE FROM messages WHERE tool_call_id='call_crashed'").run();
    expect(store.recoverInterrupted(session.id)).toBe(1);
    expect(store.recoverInterrupted(session.id)).toBe(0);
    expect(store.toolResult(session.id, "call_crashed")).toMatchObject({
      status: "interrupted",
      result: { success: false },
    });
    expect(store.messages(session.id).at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call_crashed",
    });
    const run = store.db
      .prepare("SELECT status FROM tool_runs WHERE tool_call_id='call_crashed'")
      .get() as { status: string };
    expect(run.status).toBe("interrupted");
    store.close();
  });

  it("migrates an existing v0.1 database without dropping sessions", async () => {
    const workspace = await root();
    const directory = path.join(workspace, ".alexus");
    await mkdir(directory);
    const database = new Database(path.join(directory, "alexus.db"));
    database.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL, model TEXT NOT NULL, task TEXT NOT NULL, status TEXT NOT NULL, approval_mode TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE tool_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);
      CREATE TABLE file_checkpoints (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT, original_content BLOB, latest_hash TEXT, created_at TEXT NOT NULL, UNIQUE(session_id,path));
      INSERT INTO sessions VALUES ('ses_old','${workspace.replaceAll("'", "''")}','test/model','legacy','completed','workspace','2026-01-01','2026-01-01');
    `);
    database.close();

    const migrated = new SessionStore(workspace);
    expect(migrated.get("ses_old")?.task).toBe("legacy");
    const messageColumns = migrated.db.pragma("table_info(messages)") as Array<{ name: string }>;
    expect(messageColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["payload_json", "turn_id"]),
    );
    expect(migrated.integrity()).toBe("ok");
    migrated.close();
  });
});
