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

export interface RunOptions {
  model?: string;
  json?: boolean;
  maxCost?: number;
  approvalMode?: AlexusConfig["approvalMode"];
  resumeSessionId?: string;
}
export async function executeTask(
  root: string,
  task: string,
  options: RunOptions = {},
): Promise<void> {
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
  if (resumed) store.updateStatus(session.id, "running");
  const events = new EventBus();
  events.on(options.json ? jsonlWriter() : humanRenderer());
  events.emit(event(session.id, "session.started", { workspace: root }));
  events.emit(event(session.id, "model.selected", { provider: "openrouter", model: config.model }));
  const controller = new AbortController();
  const globalTimeout = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    const result = await runAgentLoop({
      task,
      workspaceRoot: root,
      config,
      provider: new OpenRouterProvider(),
      tools: createDefaultRegistry(),
      store,
      session,
      events,
      signal: controller.signal,
      json: Boolean(options.json),
      ...(options.maxCost !== undefined ? { maxCost: options.maxCost } : {}),
    });
    store.updateStatus(session.id, result.success ? "completed" : "failed");
    events.emit(
      event(session.id, "session.completed", {
        success: result.success,
        verification: result.verification,
        steps: result.steps,
        cost: result.cost,
      }),
    );
    if (!options.json) {
      if (!result.finalMessage.endsWith("\n")) process.stdout.write("\n");
      process.stderr.write(
        `\n${result.verification === "verified" ? "VERIFICATO" : result.verification === "partial" ? "PARZIALMENTE VERIFICATO" : "NON VERIFICATO"}\nSessione: ${session.id}\n`,
      );
    }
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    store.updateStatus(session.id, controller.signal.aborted ? "cancelled" : "failed");
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
    process.removeListener("SIGINT", cancel);
    store.close();
  }
}
