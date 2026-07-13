import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/sessions/sqlite-store.js";
import { buildSessionExport } from "../src/sessions/session-export.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("session export", () => {
  it("creates a portable export and redacts secret values and fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "alexus-export-"));
    roots.push(root);
    const store = new SessionStore(root);
    const session = store.create({
      model: "test/model",
      task: "usa sk-or-v1-abcdefghijklmnopqrstuvwxyz",
      approvalMode: "workspace",
    });
    const turn = store.createTurn(session.id, "token");
    store.recordItem(turn.id, "fixture", "completed", {
      apiKey: "private-value",
      output: "ghp_abcdefghijklmnopqrstuvwxyz123456",
    });
    const exported = await buildSessionExport(store, session.id);
    const json = JSON.stringify(exported);
    expect(json).not.toContain(root);
    expect(json).not.toContain("private-value");
    expect(json).not.toContain("sk-or-v1-");
    expect(json).not.toContain("ghp_");
    expect(json).toContain("[REDACTED]");
    expect(exported).toMatchObject({ format: "alexus-session", formatVersion: 1 });
    store.close();
  });
});
