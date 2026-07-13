import { initializeWorkspace, loadConfig } from "../config/loader.js";
import type { AlexusConfig } from "../config/schema.js";
import { SessionStore } from "../sessions/sqlite-store.js";
import { EventBus } from "../protocol/event-bus.js";
import { event } from "../protocol/events.js";
import { jsonlWriter } from "../protocol/jsonl-writer.js";
import { humanRenderer } from "./renderer.js";
import { createDefaultRegistry } from "../tools/default-registry.js";
import { OpenRouterProvider } from "../providers/openrouter/openrouter-provider.js";
import { assertToolModel } from "../providers/openrouter/models.js";
import { runAgentLoop } from "../agent/agent-loop.js";
import type { EventSink } from "../protocol/events.js";
import type { ApprovalPrompt } from "../security/approval-manager.js";
import { buildSessionReport } from "../sessions/session-report.js";

export interface RunOptions {
  model?: string;
  json?: boolean;
  maxCost?: number;
  approvalMode?: AlexusConfig["approvalMode"];
  resumeSessionId?: string;
  eventSink?: EventSink;
  approvalPrompt?: ApprovalPrompt;
  embedded?: boolean;
  signal?: AbortSignal;
  forceCompact?: boolean;
}
export interface ExecutionSummary {
  sessionId: string;
  success: boolean;
  finalMessage: string;
  verification: "verified" | "partial" | "unverified";
  steps: number;
  cost: number;
  promptTokens: number;
  completionTokens: number;
}
export async function executeTask(
  root: string,
  task: string,
  options: RunOptions = {},
): Promise<ExecutionSummary> {
  await initializeWorkspace(root);
  const flags: Partial<AlexusConfig> = {};
  if (options.model) flags.model = options.model;
  if (options.approvalMode) flags.approvalMode = options.approvalMode;
  let config = await loadConfig(root, flags);
  const store = new SessionStore(root);
  const resumed = options.resumeSessionId ? store.get(options.resumeSessionId) : undefined;
  if (options.resumeSessionId && !resumed) {
    store.close();
    throw new Error(`Sessione non trovata: ${options.resumeSessionId}`);
  }
  if (resumed) config = { ...config, model: resumed.model, approvalMode: resumed.approvalMode };
  try {
    await assertToolModel(root, config.model);
  } catch (error) {
    store.close();
    throw error;
  }
  const session =
    resumed ?? store.create({ model: config.model, task, approvalMode: config.approvalMode });
  let resumeMessages: ReturnType<SessionStore["messages"]> | undefined;
  if (resumed) {
    store.updateStatus(session.id, "running");
    store.recoverInterrupted(session.id);
    resumeMessages = store.messages(session.id);
  }
  const turn = store.createTurn(session.id, task);
  const events = new EventBus();
  events.on(options.eventSink ?? (options.json ? jsonlWriter() : humanRenderer()));
  events.emit(event(session.id, "session.started", { workspace: root }));
  events.emit(event(session.id, "model.selected", { provider: "openrouter", model: config.model }));
  events.emit(event(session.id, "turn.started", { turnId: turn.id, prompt: task }));
  const controller = new AbortController();
  const externalAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", externalAbort, { once: true });
  const globalTimeout = setTimeout(() => controller.abort(), config.taskTimeoutMs);
  const cancel = () => controller.abort();
  if (!options.embedded) process.once("SIGINT", cancel);
  try {
    const result = await runAgentLoop({
      task,
      workspaceRoot: root,
      config,
      provider: new OpenRouterProvider(),
      tools: createDefaultRegistry(),
      store,
      session,
      turnId: turn.id,
      events,
      signal: controller.signal,
      json: Boolean(options.json),
      ...(options.approvalPrompt ? { approvalPrompt: options.approvalPrompt } : {}),
      ...(resumeMessages ? { resumeMessages } : {}),
      ...(options.maxCost !== undefined ? { maxCost: options.maxCost } : {}),
      ...(options.forceCompact ? { forceCompact: true } : {}),
    });
    store.updateStatus(session.id, result.success ? "completed" : "failed");
    store.finishTurn(turn.id, result.success ? "completed" : "failed");
    events.emit(
      event(session.id, "session.report", {
        report: await buildSessionReport(store, session.id),
      }),
    );
    events.emit(
      event(session.id, "turn.completed", {
        turnId: turn.id,
        success: result.success,
        verification: result.verification,
      }),
    );
    events.emit(
      event(session.id, "session.completed", {
        success: result.success,
        verification: result.verification,
        steps: result.steps,
        cost: result.cost,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      }),
    );
    if (!options.json && !options.embedded) {
      if (!result.finalMessage.endsWith("\n")) process.stdout.write("\n");
      process.stderr.write(
        `\n${result.verification === "verified" ? "VERIFICATO" : result.verification === "partial" ? "PARZIALMENTE VERIFICATO" : "NON VERIFICATO"}\nSessione: ${session.id}\n`,
      );
    }
    if (!result.success && !options.embedded) process.exitCode = 1;
    return { sessionId: session.id, ...result };
  } catch (error) {
    store.updateStatus(session.id, controller.signal.aborted ? "cancelled" : "failed");
    store.finishTurn(turn.id, controller.signal.aborted ? "cancelled" : "failed");
    events.emit(
      event(session.id, "turn.failed", {
        turnId: turn.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    events.emit(
      event(session.id, "session.completed", {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        verification: "unverified",
      }),
    );
    throw error;
  } finally {
    clearTimeout(globalTimeout);
    options.signal?.removeEventListener("abort", externalAbort);
    if (!options.embedded) process.removeListener("SIGINT", cancel);
    store.close();
  }
}
