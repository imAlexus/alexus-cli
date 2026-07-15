import type { AlexusConfig } from "../config/schema.js";
import { event } from "../protocol/events.js";
import type { EventBus } from "../protocol/event-bus.js";
import { detectProject, type VerificationCommand } from "../project/project-detector.js";
import { classifyCommand } from "../security/command-policy.js";
import type { SessionStore } from "../sessions/sqlite-store.js";
import { runCommandTool } from "../tools/shell.js";
import { createId } from "../utils/ids.js";

export interface VerificationResult {
  command: VerificationCommand;
  exitCode: number | null;
  success: boolean;
  error?: string;
}

export interface VerificationSummary {
  status: "verified" | "partial" | "unverified";
  results: VerificationResult[];
}

interface VerifierInput {
  workspaceRoot: string;
  sessionId: string;
  turnId: string;
  store: SessionStore;
  events: EventBus;
  signal: AbortSignal;
  config: AlexusConfig;
  changedFiles?: string[];
}

export function selectVerificationCommands(
  commands: VerificationCommand[],
  changedFiles: string[] = [],
): VerificationCommand[] {
  if (!changedFiles.length) return commands;
  const documentationOnly = changedFiles.every((file) => /\.(?:md|mdx|txt|adoc)$/i.test(file));
  if (documentationOnly) return [];
  const testsOnly = changedFiles.every(
    (file) =>
      /(?:^|[\\/])(?:tests?|__tests__)(?:[\\/]|$)/i.test(file) ||
      /\.(?:test|spec)\.[^.]+$/i.test(file),
  );
  return testsOnly ? commands.filter((command) => command.kind !== "build") : commands;
}

export async function runAutomaticVerification(input: VerifierInput): Promise<VerificationSummary> {
  const profile = await detectProject(input.workspaceRoot);
  const commands = selectVerificationCommands(
    profile.verificationCommands.filter(
      (command) => classifyCommand(command.command, command.args).level === "safe",
    ),
    input.changedFiles,
  );
  input.events.emit(
    event(input.sessionId, "verification.plan", {
      commands: commands.map((command) => ({ kind: command.kind, label: command.label })),
    }),
  );
  const results: VerificationResult[] = [];
  for (const command of commands) {
    if (input.signal.aborted) break;
    const toolCallId = createId("verify");
    const args = {
      command: command.command,
      args: command.args,
      timeoutMs: input.config.commandTimeoutMs,
      reason: `Automatic ${command.kind} verification`,
    };
    const { runId } = input.store.startTool(
      input.sessionId,
      input.turnId,
      toolCallId,
      "run_command",
      args,
    );
    input.events.emit(
      event(input.sessionId, "tool.requested", {
        toolCallId,
        tool: `verify:${command.kind}`,
        arguments: args,
      }),
    );
    input.events.emit(
      event(input.sessionId, "verification.started", { toolCallId, command: args }),
    );
    input.events.emit(event(input.sessionId, "tool.started", { toolCallId }));
    const started = Date.now();
    try {
      const raw = (await runCommandTool.execute(args, {
        workspaceRoot: input.workspaceRoot,
        sessionId: input.sessionId,
        store: input.store,
        events: input.events,
        signal: input.signal,
        maxOutputChars: input.config.maxToolOutputChars,
        approvalGranted: true,
        toolCallId,
      })) as { exitCode?: unknown };
      const exitCode = typeof raw.exitCode === "number" ? raw.exitCode : null;
      const success = exitCode === 0;
      const payload = { success, result: raw };
      input.store.finishTool(runId, payload, success ? "completed" : "failed");
      results.push({ command, exitCode, success });
      input.events.emit(
        event(input.sessionId, "verification.completed", { toolCallId, command: args, exitCode }),
      );
      input.events.emit(
        event(input.sessionId, "tool.completed", {
          toolCallId,
          success,
          durationMs: Date.now() - started,
          ...(!success ? { error: `Exit code ${String(exitCode)}` } : {}),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      input.store.finishTool(runId, { success: false, error: message }, "failed");
      results.push({ command, exitCode: null, success: false, error: message });
      input.events.emit(
        event(input.sessionId, "verification.completed", {
          toolCallId,
          command: args,
          exitCode: null,
          error: message,
        }),
      );
      input.events.emit(
        event(input.sessionId, "tool.completed", {
          toolCallId,
          success: false,
          durationMs: Date.now() - started,
          error: message,
        }),
      );
    }
  }
  const passed = results.filter((result) => result.success).length;
  const status =
    results.length === 0
      ? "partial"
      : passed === results.length
        ? "verified"
        : passed > 0
          ? "partial"
          : "unverified";
  return { status, results };
}

export function formatVerificationSummary(summary: VerificationSummary): string {
  if (!summary.results.length) return "Automatic verification: no safe command detected.";
  return [
    "Automatic verification:",
    ...summary.results.map(
      (result) =>
        `- ${result.success ? "OK" : "FAIL"} ${result.command.label}${result.error ? `: ${result.error}` : ""}`,
    ),
  ].join("\n");
}
