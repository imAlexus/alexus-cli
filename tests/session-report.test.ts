import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/sessions/sqlite-store.js";
import { buildSessionReport, formatSessionReport } from "../src/sessions/session-report.js";
import { applyPatchTool } from "../src/tools/filesystem.js";
import { EventBus } from "../src/protocol/event-bus.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("session report", () => {
  it("aggregates changes, checks, usage, plan and approvals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "alexus-report-"));
    roots.push(root);
    await writeFile(path.join(root, "code.ts"), "const value = 1;\n");
    const store = new SessionStore(root);
    const session = store.create({ model: "test/model", task: "fix", approvalMode: "workspace" });
    const turn = store.createTurn(session.id, "fix");
    await applyPatchTool.execute(
      { path: "code.ts", oldText: "value = 1", newText: "value = 2" },
      {
        workspaceRoot: root,
        sessionId: session.id,
        store,
        events: new EventBus(),
        signal: new AbortController().signal,
        maxOutputChars: 1_000,
      },
    );
    const { runId } = store.startTool(session.id, turn.id, "check_1", "run_command", {
      command: "pnpm",
      args: ["test"],
    });
    store.finishTool(runId, { success: true, result: { exitCode: 0 } });
    store.recordItem(turn.id, "usage", "completed", {
      promptTokens: 100,
      completionTokens: 20,
      estimatedCost: 0.01,
    });
    store.savePlan(session.id, [{ step: "Fix", status: "completed" }]);
    store.rememberApproval(session.id, "hash", "run_command", "moderate");

    const report = await buildSessionReport(store, session.id);
    expect(report).toMatchObject({
      changedFiles: ["code.ts"],
      insertions: 1,
      deletions: 1,
      usage: { promptTokens: 100, completionTokens: 20, estimatedCost: 0.01 },
      rememberedApprovals: 1,
      verificationRuns: [{ command: "pnpm test", status: "completed", exitCode: 0 }],
    });
    expect(formatSessionReport(report)).toContain("+1 -1");
    store.close();
  });
});
