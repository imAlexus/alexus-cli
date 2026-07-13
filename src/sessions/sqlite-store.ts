import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { createId } from "../utils/ids.js";
import { AlexusError } from "../utils/errors.js";
import { assertSafeWritePath } from "../security/path-policy.js";
import type OpenAI from "openai";

export type SessionStatus = "running" | "completed" | "failed" | "cancelled";
export interface StoredSession {
  id: string;
  workspaceRoot: string;
  model: string;
  task: string;
  status: SessionStatus;
  approvalMode: "readonly" | "workspace" | "full-access";
  createdAt: string;
  updatedAt: string;
}
export type TurnStatus = "running" | "completed" | "failed" | "cancelled";
export interface StoredTurn {
  id: string;
  sessionId: string;
  prompt: string;
  status: TurnStatus;
  startedAt: string;
  completedAt?: string;
}
export interface StoredToolResult {
  status: string;
  result: unknown;
}
export interface StoredItem {
  id: string;
  turnId: string;
  type: string;
  status: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}
export type PlanStepStatus = "pending" | "in_progress" | "completed";
export interface StoredPlanStep {
  step: string;
  status: PlanStepStatus;
}
export interface StoredPlan {
  sessionId: string;
  explanation?: string;
  steps: StoredPlanStep[];
  updatedAt: string;
}
const hash = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

export class SessionStore {
  readonly db: Database.Database;
  constructor(readonly workspaceRoot: string) {
    const dir = path.join(workspaceRoot, ".alexus");
    mkdirSync(dir, { recursive: true });
    this.db = new Database(path.join(dir, "alexus.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }
  private migrate(): void {
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL, model TEXT NOT NULL, task TEXT NOT NULL, status TEXT NOT NULL, approval_mode TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS tool_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS file_checkpoints (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, path TEXT NOT NULL, original_hash TEXT, original_content BLOB, latest_hash TEXT, created_at TEXT NOT NULL, UNIQUE(session_id,path), FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, turn_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(turn_id) REFERENCES turns(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS session_plans (session_id TEXT PRIMARY KEY, explanation TEXT, plan_json TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS session_approvals (session_id TEXT NOT NULL, approval_key TEXT NOT NULL, tool TEXT NOT NULL, risk TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id,approval_key), FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
  `);
    this.addColumn("messages", "payload_json", "TEXT");
    this.addColumn("messages", "turn_id", "TEXT");
    this.addColumn("tool_runs", "turn_id", "TEXT");
    this.addColumn("tool_runs", "item_id", "TEXT");
    this.addColumn("tool_runs", "tool_call_id", "TEXT");
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS tool_runs_call_id ON tool_runs(session_id,tool_call_id) WHERE tool_call_id IS NOT NULL",
    );
  }
  private addColumn(table: string, column: string, definition: string): void {
    const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!columns.some((entry) => entry.name === column))
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  create(input: Pick<StoredSession, "model" | "task" | "approvalMode">): StoredSession {
    const now = new Date().toISOString();
    const session: StoredSession = {
      id: createId("ses"),
      workspaceRoot: this.workspaceRoot,
      status: "running",
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.db
      .prepare(
        "INSERT INTO sessions VALUES (@id,@workspaceRoot,@model,@task,@status,@approvalMode,@createdAt,@updatedAt)",
      )
      .run(session);
    return session;
  }
  get(id: string): StoredSession | undefined {
    return this.map(
      this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id) as
        Record<string, string> | undefined,
    );
  }
  latest(): StoredSession | undefined {
    return this.map(
      this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1").get() as
        Record<string, string> | undefined,
    );
  }
  list(): StoredSession[] {
    return (
      this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Record<
        string,
        string
      >[]
    ).map((r) => this.map(r)!);
  }
  private map(r?: Record<string, string>): StoredSession | undefined {
    return r
      ? {
          id: r.id!,
          workspaceRoot: r.workspace_root!,
          model: r.model!,
          task: r.task!,
          status: r.status as SessionStatus,
          approvalMode: r.approval_mode as StoredSession["approvalMode"],
          createdAt: r.created_at!,
          updatedAt: r.updated_at!,
        }
      : undefined;
  }
  updateStatus(id: string, status: SessionStatus): void {
    this.db
      .prepare("UPDATE sessions SET status=?,updated_at=? WHERE id=?")
      .run(status, new Date().toISOString(), id);
  }
  createTurn(sessionId: string, prompt: string): StoredTurn {
    const turn: StoredTurn = {
      id: createId("turn"),
      sessionId,
      prompt,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO turns (id,session_id,prompt,status,started_at,completed_at) VALUES (@id,@sessionId,@prompt,@status,@startedAt,NULL)",
      )
      .run(turn);
    return turn;
  }
  finishTurn(id: string, status: TurnStatus): void {
    this.db
      .prepare("UPDATE turns SET status=?,completed_at=? WHERE id=?")
      .run(status, new Date().toISOString(), id);
  }
  turns(sessionId: string): StoredTurn[] {
    return (
      this.db
        .prepare(
          "SELECT id,session_id,prompt,status,started_at,completed_at FROM turns WHERE session_id=? ORDER BY started_at,rowid",
        )
        .all(sessionId) as Array<Record<string, string | null>>
    ).map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      prompt: String(row.prompt),
      status: row.status as TurnStatus,
      startedAt: String(row.started_at),
      ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
    }));
  }
  recordItem(turnId: string, type: string, status: string, payload: unknown): string {
    const id = createId("item");
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO items (id,turn_id,type,status,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(id, turnId, type, status, JSON.stringify(payload), now, now);
    return id;
  }
  items(turnId: string): StoredItem[] {
    return (
      this.db
        .prepare(
          "SELECT id,turn_id,type,status,payload_json,created_at,updated_at FROM items WHERE turn_id=? ORDER BY created_at,rowid",
        )
        .all(turnId) as Array<{
        id: string;
        turn_id: string;
        type: string;
        status: string;
        payload_json: string;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
      id: row.id,
      turnId: row.turn_id,
      type: row.type,
      status: row.status,
      payload: JSON.parse(row.payload_json) as unknown,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  savePlan(sessionId: string, steps: StoredPlanStep[], explanation?: string): StoredPlan {
    const updatedAt = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO session_plans (session_id,explanation,plan_json,updated_at) VALUES (?,?,?,?)
           ON CONFLICT(session_id) DO UPDATE SET explanation=excluded.explanation,plan_json=excluded.plan_json,updated_at=excluded.updated_at`,
        )
        .run(sessionId, explanation ?? null, JSON.stringify(steps), updatedAt);
      this.db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(updatedAt, sessionId);
    })();
    return { sessionId, ...(explanation ? { explanation } : {}), steps, updatedAt };
  }
  plan(sessionId: string): StoredPlan | undefined {
    const row = this.db
      .prepare("SELECT explanation,plan_json,updated_at FROM session_plans WHERE session_id=?")
      .get(sessionId) as
      { explanation: string | null; plan_json: string; updated_at: string } | undefined;
    if (!row) return undefined;
    return {
      sessionId,
      ...(row.explanation ? { explanation: row.explanation } : {}),
      steps: JSON.parse(row.plan_json) as StoredPlanStep[],
      updatedAt: row.updated_at,
    };
  }
  clearPlan(sessionId: string): boolean {
    return (
      this.db.prepare("DELETE FROM session_plans WHERE session_id=?").run(sessionId).changes > 0
    );
  }
  rememberApproval(sessionId: string, key: string, tool: string, risk: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO session_approvals (session_id,approval_key,tool,risk,created_at) VALUES (?,?,?,?,?)",
      )
      .run(sessionId, key, tool, risk, now);
    this.db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(now, sessionId);
  }
  approvals(sessionId: string): string[] {
    return (
      this.db
        .prepare(
          "SELECT approval_key FROM session_approvals WHERE session_id=? ORDER BY created_at",
        )
        .all(sessionId) as Array<{ approval_key: string }>
    ).map((row) => row.approval_key);
  }
  addMessage(
    sessionId: string,
    message: OpenAI.Chat.Completions.ChatCompletionMessageParam,
    turnId?: string,
  ): void {
    const toolCallId = message.role === "tool" ? message.tool_call_id : null;
    const content =
      typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    this.db
      .prepare(
        "INSERT INTO messages (id,session_id,role,content,tool_call_id,created_at,payload_json,turn_id) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        createId("msg"),
        sessionId,
        message.role,
        content,
        toolCallId,
        new Date().toISOString(),
        JSON.stringify(message),
        turnId ?? null,
      );
  }
  messages(sessionId: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return (
      this.db
        .prepare(
          "SELECT role,content,tool_call_id,payload_json FROM messages WHERE session_id=? ORDER BY created_at,rowid",
        )
        .all(sessionId) as Array<{
        role: string;
        content: string;
        tool_call_id: string | null;
        payload_json: string | null;
      }>
    ).map((row) => {
      if (row.payload_json)
        return JSON.parse(row.payload_json) as OpenAI.Chat.Completions.ChatCompletionMessageParam;
      if (row.role === "tool" && row.tool_call_id)
        return { role: "tool", content: row.content, tool_call_id: row.tool_call_id };
      if (row.role === "system" || row.role === "user" || row.role === "assistant")
        return { role: row.role, content: row.content };
      throw new AlexusError("DATABASE_ERROR", `Ruolo messaggio non valido: ${row.role}`);
    });
  }
  startTool(
    sessionId: string,
    turnId: string,
    toolCallId: string,
    name: string,
    args: unknown,
  ): { runId: string; itemId: string } {
    const runId = createId("run");
    const itemId = createId("item");
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO items (id,turn_id,type,status,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          itemId,
          turnId,
          "tool_call",
          "running",
          JSON.stringify({ toolCallId, name, args }),
          now,
          now,
        );
      this.db
        .prepare(
          "INSERT INTO tool_runs (id,session_id,tool_name,arguments_json,result_json,status,started_at,completed_at,turn_id,item_id,tool_call_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          runId,
          sessionId,
          name,
          JSON.stringify(args),
          null,
          "running",
          now,
          null,
          turnId,
          itemId,
          toolCallId,
        );
    })();
    return { runId, itemId };
  }
  finishTool(id: string, result: unknown, status = "completed"): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT item_id FROM tool_runs WHERE id=?").get(id) as
        { item_id: string | null } | undefined;
      this.db
        .prepare("UPDATE tool_runs SET result_json=?,status=?,completed_at=? WHERE id=?")
        .run(JSON.stringify(result), status, now, id);
      if (row?.item_id)
        this.db
          .prepare("UPDATE items SET status=?,payload_json=?,updated_at=? WHERE id=?")
          .run(
            status === "completed" ? "completed" : "failed",
            JSON.stringify(result),
            now,
            row.item_id,
          );
    })();
  }
  toolResult(sessionId: string, toolCallId: string): StoredToolResult | undefined {
    const row = this.db
      .prepare(
        "SELECT status,result_json FROM tool_runs WHERE session_id=? AND tool_call_id=? AND result_json IS NOT NULL",
      )
      .get(sessionId, toolCallId) as { status: string; result_json: string } | undefined;
    return row ? { status: row.status, result: JSON.parse(row.result_json) as unknown } : undefined;
  }
  recoverInterrupted(sessionId: string): number {
    const rows = this.db
      .prepare(
        `SELECT id,turn_id,item_id,tool_call_id,tool_name,status,result_json
         FROM tool_runs tr
         WHERE session_id=? AND (
           status='running' OR (
             status='interrupted' AND tool_call_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM messages m
               WHERE m.session_id=tr.session_id AND m.tool_call_id=tr.tool_call_id
             )
           )
         )`,
      )
      .all(sessionId) as Array<{
      id: string;
      turn_id: string | null;
      item_id: string | null;
      tool_call_id: string | null;
      tool_name: string;
      status: string;
      result_json: string | null;
    }>;
    for (const row of rows) {
      const result = row.result_json
        ? (JSON.parse(row.result_json) as unknown)
        : { success: false, error: `Tool ${row.tool_name} interrotto dal processo precedente.` };
      const now = new Date().toISOString();
      this.db.transaction(() => {
        if (row.status === "running") {
          this.db
            .prepare(
              "UPDATE tool_runs SET result_json=?,status='interrupted',completed_at=? WHERE id=?",
            )
            .run(JSON.stringify(result), now, row.id);
          if (row.item_id)
            this.db
              .prepare("UPDATE items SET status='failed',payload_json=?,updated_at=? WHERE id=?")
              .run(JSON.stringify(result), now, row.item_id);
        }
        if (row.tool_call_id) {
          const message: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
            role: "tool",
            tool_call_id: row.tool_call_id,
            content: JSON.stringify(result),
          };
          this.db
            .prepare(
              "INSERT INTO messages (id,session_id,role,content,tool_call_id,created_at,payload_json,turn_id) VALUES (?,?,?,?,?,?,?,?)",
            )
            .run(
              createId("msg"),
              sessionId,
              "tool",
              message.content,
              row.tool_call_id,
              now,
              JSON.stringify(message),
              row.turn_id,
            );
        }
      })();
    }
    return rows.length;
  }
  async checkpoint(sessionId: string, relativePath: string): Promise<void> {
    const existing = this.db
      .prepare("SELECT 1 FROM file_checkpoints WHERE session_id=? AND path=?")
      .get(sessionId, relativePath);
    if (existing) return;
    const file = await assertSafeWritePath(this.workspaceRoot, relativePath);
    let content: Buffer | null = null;
    try {
      content = await readFile(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    this.db
      .prepare("INSERT INTO file_checkpoints VALUES (?,?,?,?,?,?,?)")
      .run(
        createId("cp"),
        sessionId,
        relativePath,
        content ? hash(content) : null,
        content,
        null,
        new Date().toISOString(),
      );
  }
  async markWritten(sessionId: string, relativePath: string): Promise<void> {
    const file = await assertSafeWritePath(this.workspaceRoot, relativePath);
    const content = await readFile(file);
    this.db
      .prepare("UPDATE file_checkpoints SET latest_hash=? WHERE session_id=? AND path=?")
      .run(hash(content), sessionId, relativePath);
  }
  changedFiles(sessionId: string): string[] {
    return (
      this.db
        .prepare("SELECT path FROM file_checkpoints WHERE session_id=?")
        .all(sessionId) as Array<{ path: string }>
    ).map((r) => r.path);
  }
  async diff(sessionId: string): Promise<string> {
    const rows = this.db
      .prepare(
        "SELECT path,original_content FROM file_checkpoints WHERE session_id=? ORDER BY created_at",
      )
      .all(sessionId) as Array<{ path: string; original_content: Buffer | null }>;
    const patches: string[] = [];
    for (const row of rows) {
      const file = await assertSafeWritePath(this.workspaceRoot, row.path);
      let current: Buffer | null = null;
      try {
        current = await readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const before = row.original_content?.toString("utf8") ?? "";
      const after = current?.toString("utf8") ?? "";
      if (before !== after)
        patches.push(createTwoFilesPatch(row.path, row.path, before, after, "prima", "dopo"));
    }
    return patches.join("\n");
  }
  async undo(sessionId: string): Promise<string[]> {
    const rows = this.db
      .prepare(
        "SELECT path,original_content,latest_hash FROM file_checkpoints WHERE session_id=? ORDER BY created_at DESC",
      )
      .all(sessionId) as Array<{
      path: string;
      original_content: Buffer | null;
      latest_hash: string | null;
    }>;
    const restored: string[] = [];
    for (const row of rows) {
      const file = await assertSafeWritePath(this.workspaceRoot, row.path);
      let current: Buffer | null = null;
      try {
        current = await readFile(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (row.latest_hash && (!current || hash(current) !== row.latest_hash))
        throw new AlexusError(
          "PATCH_CONFLICT",
          `Undo interrotto: ${row.path} è stato modificato dopo Alexus.`,
        );
      if (row.original_content === null) await rm(file, { force: true });
      else await writeFile(file, row.original_content);
      restored.push(row.path);
    }
    return restored;
  }
  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE id=?").run(id).changes > 0;
  }
  integrity(): string {
    const result = this.db.pragma("integrity_check", { simple: true });
    return typeof result === "string" ? result : "unknown";
  }
  close(): void {
    this.db.close();
  }
}
