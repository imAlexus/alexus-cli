import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAgentLoop } from "../src/agent/agent-loop.js";
import { defaultConfig } from "../src/config/schema.js";
import { EventBus } from "../src/protocol/event-bus.js";
import type { AlexusEvent } from "../src/protocol/events.js";
import type { Provider, ProviderResponse } from "../src/providers/provider.js";
import { buildSessionReport } from "../src/sessions/session-report.js";
import { SessionStore } from "../src/sessions/sqlite-store.js";
import { createDefaultRegistry } from "../src/tools/default-registry.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("MVP end-to-end", () => {
  it("edits code, runs verification, persists events and builds an auditable report", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "alexus-e2e-"));
    roots.push(workspace);
    await writeFile(path.join(workspace, "value.js"), "export const value = 1;\n");
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node -e \"import('./value.js').then(m=>{if(m.value!==2)process.exit(1)})\"",
        },
      }),
    );
    const editArgs = JSON.stringify({
      edits: [{ path: "value.js", oldText: "value = 1", newText: "value = 2" }],
    });
    const commandArgs = JSON.stringify({
      command: "npm",
      args: ["test"],
      timeoutMs: 30_000,
      reason: "verifica il comportamento modificato",
    });
    const responses: ProviderResponse[] = [
      {
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "edit_1",
              type: "function",
              function: { name: "apply_edits", arguments: editArgs },
            },
          ],
        },
        text: "",
        toolCalls: [{ id: "edit_1", name: "apply_edits", arguments: editArgs }],
      },
      {
        message: {
          role: "assistant",
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: "test_1",
              type: "function",
              function: { name: "run_command", arguments: commandArgs },
            },
          ],
        },
        text: "",
        toolCalls: [{ id: "test_1", name: "run_command", arguments: commandArgs }],
      },
      {
        message: { role: "assistant", content: "Modifica verificata.", refusal: null },
        text: "Modifica verificata.",
        toolCalls: [],
        usage: { promptTokens: 20, completionTokens: 5, cost: 0.001 },
      },
    ];
    const provider: Provider = {
      generate() {
        const response = responses.shift();
        return response
          ? Promise.resolve(response)
          : Promise.reject(new Error("Chiamata provider inattesa"));
      },
    };
    const store = new SessionStore(workspace);
    const session = store.create({
      model: "test/model",
      task: "aggiorna value",
      approvalMode: "workspace",
    });
    const turn = store.createTurn(session.id, "aggiorna value");
    const events = new EventBus();
    const received: AlexusEvent[] = [];
    events.on((value) => received.push(value));

    const result = await runAgentLoop({
      task: "aggiorna value",
      workspaceRoot: workspace,
      config: defaultConfig,
      provider,
      tools: createDefaultRegistry(),
      store,
      session,
      turnId: turn.id,
      events,
      signal: new AbortController().signal,
      json: true,
    });
    store.finishTurn(turn.id, "completed");
    store.updateStatus(session.id, "completed");
    const report = await buildSessionReport(store, session.id);

    expect(result).toMatchObject({ success: true, verification: "verified" });
    expect(await readFile(path.join(workspace, "value.js"), "utf8")).toContain("value = 2");
    expect(report.changedFiles).toEqual(["value.js"]);
    expect(report.verificationRuns).toMatchObject([{ exitCode: 0, status: "completed" }]);
    expect(report.usage).toMatchObject({ promptTokens: 20, completionTokens: 5 });
    expect(received.some((event) => event.type === "file.changed")).toBe(true);
    expect(received.some((event) => event.type === "verification.completed")).toBe(true);
    store.close();
  });
});
