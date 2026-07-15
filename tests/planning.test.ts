import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/sessions/sqlite-store.js";
import { EventBus } from "../src/protocol/event-bus.js";
import type { AlexusEvent } from "../src/protocol/events.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { updatePlanTool } from "../src/tools/planning.js";
import { runAgentLoop } from "../src/agent/agent-loop.js";
import { defaultConfig } from "../src/config/schema.js";
import type { Provider } from "../src/providers/provider.js";
import { ApprovalManager } from "../src/security/approval-manager.js";

const roots: string[] = [];
async function fixture() {
  const workspace = await mkdtemp(path.join(tmpdir(), "alexus-plan-"));
  roots.push(workspace);
  const store = new SessionStore(workspace);
  const session = store.create({ model: "test/model", task: "plan", approvalMode: "workspace" });
  const events = new EventBus();
  const received: AlexusEvent[] = [];
  events.on((value) => received.push(value));
  return {
    workspace,
    store,
    session,
    events,
    received,
    context: {
      workspaceRoot: workspace,
      sessionId: session.id,
      store,
      events,
      signal: new AbortController().signal,
      maxOutputChars: 1_000,
    },
  };
}
afterEach(async () => {
  for (const workspace of roots.splice(0)) await rm(workspace, { recursive: true, force: true });
});

describe("durable plans", () => {
  it("validates, emits and persists structured plan updates", async () => {
    const value = await fixture();
    const registry = new ToolRegistry().register(updatePlanTool);
    await registry.execute(
      {
        id: "plan_1",
        name: "update_plan",
        arguments: JSON.stringify({
          explanation: "Two-stage implementation",
          plan: [
            { step: "Analyze", status: "completed" },
            { step: "Implement", status: "in_progress" },
          ],
        }),
      },
      value.context,
    );

    expect(value.store.plan(value.session.id)).toMatchObject({
      explanation: "Two-stage implementation",
      steps: [
        { step: "Analyze", status: "completed" },
        { step: "Implement", status: "in_progress" },
      ],
    });
    expect(value.received.some((event) => event.type === "plan.updated")).toBe(true);
    value.store.close();
  });

  it("rejects plans with more than one active step", async () => {
    const value = await fixture();
    const registry = new ToolRegistry().register(updatePlanTool);
    await expect(
      registry.execute(
        {
          id: "plan_invalid",
          name: "update_plan",
          arguments: JSON.stringify({
            plan: [
              { step: "One", status: "in_progress" },
              { step: "Two", status: "in_progress" },
            ],
          }),
        },
        value.context,
      ),
    ).rejects.toThrow(/at most one in-progress step/);
    expect(value.store.plan(value.session.id)).toBeUndefined();
    value.store.close();
  });

  it("persists approvals and cascades durable state on session deletion", async () => {
    const value = await fixture();
    value.store.savePlan(value.session.id, [{ step: "Test", status: "pending" }]);
    const approvalKey = ApprovalManager.commandKey("pnpm", ["install"]);
    value.store.rememberApproval(value.session.id, approvalKey, "run_command", "moderate");
    value.store.close();

    const reopened = new SessionStore(value.workspace);
    expect(reopened.approvals(value.session.id)).toEqual([approvalKey]);
    expect(reopened.plan(value.session.id)?.steps).toHaveLength(1);
    expect(reopened.delete(value.session.id)).toBe(true);
    expect(reopened.approvals(value.session.id)).toEqual([]);
    expect(reopened.plan(value.session.id)).toBeUndefined();
    reopened.close();
  });

  it("marks a final answer partial while its durable plan is incomplete", async () => {
    const value = await fixture();
    value.store.savePlan(value.session.id, [{ step: "Implement", status: "pending" }]);
    const turn = value.store.createTurn(value.session.id, "continua");
    const provider: Provider = {
      generate() {
        return Promise.resolve({
          message: { role: "assistant", content: "Risultato", refusal: null },
          text: "Risultato",
          toolCalls: [],
        });
      },
    };
    const result = await runAgentLoop({
      task: "continua",
      workspaceRoot: value.workspace,
      config: defaultConfig,
      provider,
      tools: new ToolRegistry(),
      store: value.store,
      session: value.session,
      turnId: turn.id,
      events: value.events,
      signal: new AbortController().signal,
      json: true,
    });
    expect(result.verification).toBe("partial");
    expect(value.received.some((event) => event.type === "plan.incomplete")).toBe(true);
    value.store.close();
  });
});
