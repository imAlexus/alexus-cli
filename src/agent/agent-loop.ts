import type OpenAI from "openai";
import type { AlexusConfig } from "../config/schema.js";
import type { Provider } from "../providers/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { SessionStore, StoredSession } from "../sessions/sqlite-store.js";
import type { EventBus } from "../protocol/event-bus.js";
import { event } from "../protocol/events.js";
import { ApprovalManager } from "../security/approval-manager.js";
import { AlexusError } from "../utils/errors.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { buildProjectContext } from "../context/context-builder.js";

export interface AgentInput {
  task: string;
  workspaceRoot: string;
  config: AlexusConfig;
  provider: Provider;
  tools: ToolRegistry;
  store: SessionStore;
  session: StoredSession;
  turnId: string;
  events: EventBus;
  signal: AbortSignal;
  json: boolean;
  maxCost?: number;
  resumeMessages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}
export interface AgentResult {
  success: boolean;
  finalMessage: string;
  steps: number;
  verification: "verified" | "partial" | "unverified";
  cost: number;
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new AlexusError("USER_CANCELLED", "Operazione annullata."));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function generateWithRetry(
  input: AgentInput,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await input.provider.generate({
        model: input.config.model,
        messages,
        tools: input.tools.definitions(),
        temperature: input.config.temperature,
        signal: input.signal,
        onText: (delta) =>
          input.events.emit(event(input.session.id, "assistant.delta", { text: delta })),
      });
    } catch (error) {
      if (!(error instanceof AlexusError) || !error.recoverable || attempt >= 2) throw error;
      const delayMs = 500 * 2 ** attempt;
      input.events.emit(
        event(input.session.id, "model.retry", {
          attempt: attempt + 1,
          delayMs,
          error: error.code,
        }),
      );
      await wait(delayMs, input.signal);
    }
  }
}
export async function runAgentLoop(input: AgentInput): Promise<AgentResult> {
  const context = await buildProjectContext(input.workspaceRoot);
  const systemMessage: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
    role: "system",
    content: `${SYSTEM_PROMPT}\n\nContesto iniziale:\n${context}`,
  };
  const userMessage: OpenAI.Chat.Completions.ChatCompletionUserMessageParam = {
    role: "user",
    content: input.task,
  };
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = input.resumeMessages
    ? [...input.resumeMessages, userMessage]
    : [systemMessage, userMessage];
  if (!input.resumeMessages) input.store.addMessage(input.session.id, systemMessage, input.turnId);
  input.store.addMessage(input.session.id, userMessage, input.turnId);
  const approval = new ApprovalManager(
    input.config.approvalMode,
    Boolean(process.stdin.isTTY),
    input.json,
  );
  let cost = 0;
  let mutations = 0;
  let successfulChecks = 0;
  const signatures: string[] = [];
  for (let step = 1; step <= input.config.maxSteps; step++) {
    if (input.signal.aborted) throw new AlexusError("USER_CANCELLED", "Operazione annullata.");
    if (input.maxCost !== undefined && cost >= input.maxCost)
      throw new AlexusError(
        "OPENROUTER_PROVIDER_ERROR",
        `Limite costo di $${input.maxCost.toFixed(2)} raggiunto.`,
      );
    const response = await generateWithRetry(input, messages);
    messages.push(response.message);
    input.store.addMessage(input.session.id, response.message, input.turnId);
    input.store.recordItem(input.turnId, "assistant_message", "completed", response.message);
    if (response.usage) {
      cost += response.usage.cost ?? 0;
      input.events.emit(
        event(input.session.id, "usage.updated", {
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          estimatedCost: cost,
        }),
      );
    }
    if (!response.toolCalls.length) {
      const verification =
        mutations === 0 ? "verified" : successfulChecks > 0 ? "verified" : "partial";
      return { success: true, finalMessage: response.text, steps: step, verification, cost };
    }
    for (const call of response.toolCalls) {
      const signature = `${call.name}:${call.arguments}`;
      signatures.push(signature);
      if (signatures.length >= 4 && signatures.slice(-4).every((x) => x === signature))
        throw new AlexusError(
          "TOOL_VALIDATION_FAILED",
          `Loop rilevato: tool ${call.name} ripetuto.`,
        );
      let args: unknown;
      try {
        args = JSON.parse(call.arguments);
      } catch {
        args = {};
      }
      input.events.emit(
        event(input.session.id, "tool.requested", {
          toolCallId: call.id,
          tool: call.name,
          arguments: args,
        }),
      );
      const previous = input.store.toolResult(input.session.id, call.id);
      if (previous) {
        const reusedMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(previous.result),
        };
        messages.push(reusedMessage);
        input.store.addMessage(input.session.id, reusedMessage, input.turnId);
        input.store.recordItem(input.turnId, "tool_reused", "completed", {
          toolCallId: call.id,
          status: previous.status,
        });
        input.events.emit(
          event(input.session.id, "tool.reused", {
            toolCallId: call.id,
            status: previous.status,
          }),
        );
        continue;
      }
      const decision = await approval.evaluate(call.name, args);
      if (decision.risk !== "safe")
        input.events.emit(
          event(input.session.id, "approval.required", {
            toolCallId: call.id,
            risk: decision.risk,
            allowed: decision.allowed,
            reason: decision.reason,
          }),
        );
      if (!decision.allowed) {
        const result = { success: false, error: `Rifiutato: ${decision.reason}` };
        const rejectedMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        };
        messages.push(rejectedMessage);
        input.store.addMessage(input.session.id, rejectedMessage, input.turnId);
        input.store.recordItem(input.turnId, "approval", "denied", {
          toolCallId: call.id,
          reason: decision.reason,
        });
        continue;
      }
      const { runId } = input.store.startTool(
        input.session.id,
        input.turnId,
        call.id,
        call.name,
        args,
      );
      const started = Date.now();
      if (call.name === "run_command")
        input.events.emit(event(input.session.id, "verification.started", { command: args }));
      input.events.emit(event(input.session.id, "tool.started", { toolCallId: call.id }));
      try {
        const result = await input.tools.execute(call, {
          workspaceRoot: input.workspaceRoot,
          sessionId: input.session.id,
          store: input.store,
          events: input.events,
          signal: input.signal,
          maxOutputChars: input.config.maxToolOutputChars,
          approvalGranted: true,
        });
        const payload = { success: true, result };
        input.store.finishTool(runId, payload);
        const completedMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(payload),
        };
        messages.push(completedMessage);
        input.store.addMessage(input.session.id, completedMessage, input.turnId);
        if (call.name === "apply_patch" || call.name === "write_file") {
          mutations++;
          const changed = result as { path?: unknown };
          const changedPath = typeof changed.path === "string" ? changed.path : "unknown";
          input.events.emit(event(input.session.id, "file.changed", { path: changedPath }));
        }
        if (call.name === "run_command" && (result as { exitCode?: unknown }).exitCode === 0)
          successfulChecks++;
        if (call.name === "run_command")
          input.events.emit(
            event(input.session.id, "verification.completed", {
              command: args,
              exitCode: (result as { exitCode?: unknown }).exitCode,
            }),
          );
        input.events.emit(
          event(input.session.id, "tool.completed", {
            toolCallId: call.id,
            success: true,
            durationMs: Date.now() - started,
          }),
        );
      } catch (error) {
        const payload = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
        if (call.name === "run_command")
          input.events.emit(
            event(input.session.id, "verification.completed", {
              command: args,
              exitCode: null,
              error: payload.error,
            }),
          );
        input.store.finishTool(runId, payload, "failed");
        const failedMessage: OpenAI.Chat.Completions.ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(payload),
        };
        messages.push(failedMessage);
        input.store.addMessage(input.session.id, failedMessage, input.turnId);
        input.events.emit(
          event(input.session.id, "tool.completed", {
            toolCallId: call.id,
            success: false,
            durationMs: Date.now() - started,
            error: payload.error,
          }),
        );
      }
    }
  }
  return {
    success: false,
    finalMessage: `Raggiunto il limite di ${input.config.maxSteps} passi`,
    steps: input.config.maxSteps,
    verification: "unverified",
    cost,
  };
}
