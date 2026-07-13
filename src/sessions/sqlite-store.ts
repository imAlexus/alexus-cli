import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { createId } from "../utils/ids.js";
import { AlexusError } from "../utils/errors.js";
import { assertSafeWritePath } from "../security/path-policy.js";

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
  `);
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
  addMessage(sessionId: string, role: string, content: string, toolCallId?: string): void {
    this.db
      .prepare("INSERT INTO messages VALUES (?,?,?,?,?,?)")
      .run(createId("msg"), sessionId, role, content, toolCallId ?? null, new Date().toISOString());
  }
  messages(sessionId: string): Array<{ role: string; content: string; toolCallId?: string }> {
    return (
      this.db
        .prepare(
          "SELECT role,content,tool_call_id FROM messages WHERE session_id=? ORDER BY created_at",
        )
        .all(sessionId) as Array<{ role: string; content: string; tool_call_id: string | null }>
    ).map((r) => ({
      role: r.role,
      content: r.content,
      ...(r.tool_call_id ? { toolCallId: r.tool_call_id } : {}),
    }));
  }
  startTool(sessionId: string, name: string, args: unknown): string {
    const id = createId("run");
    this.db
      .prepare("INSERT INTO tool_runs VALUES (?,?,?,?,?,?,?,?)")
      .run(
        id,
        sessionId,
        name,
        JSON.stringify(args),
        null,
        "running",
        new Date().toISOString(),
        null,
      );
    return id;
  }
  finishTool(id: string, result: unknown, status = "completed"): void {
    this.db
      .prepare("UPDATE tool_runs SET result_json=?,status=?,completed_at=? WHERE id=?")
      .run(JSON.stringify(result), status, new Date().toISOString(), id);
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
