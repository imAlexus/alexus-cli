import pc from "picocolors";
import type { EventSink } from "../protocol/events.js";
export const humanRenderer =
  (quiet = false): EventSink =>
  (event) => {
    if (quiet) return;
    switch (event.type) {
      case "assistant.delta":
        process.stdout.write(String(event.text));
        break;
      case "tool.requested":
        process.stderr.write(`${pc.cyan("→")} ${String(event.tool)}\n`);
        break;
      case "tool.completed":
        process.stderr.write(
          `${event.success ? pc.green("✓") : pc.red("✗")} ${String(event.toolCallId)} (${String(event.durationMs)} ms)\n`,
        );
        break;
      case "usage.updated":
        if (Number(event.estimatedCost) > 0)
          process.stderr.write(
            pc.dim(`Estimated cost: $${Number(event.estimatedCost).toFixed(4)}\n`),
          );
        break;
      case "verification.plan": {
        const commands = Array.isArray(event.commands)
          ? event.commands.flatMap((command) => {
              if (typeof command !== "object" || command === null) return [];
              const label = (command as { label?: unknown }).label;
              return typeof label === "string" ? [label] : [];
            })
          : [];
        if (commands.length)
          process.stderr.write(pc.dim(`Automatic checks: ${commands.join(", ")}\n`));
        break;
      }
      case "command.output":
        if (typeof event.text === "string")
          (event.stream === "stderr" ? process.stderr : process.stdout).write(event.text);
        break;
      case "context.built":
        process.stderr.write(
          pc.dim(
            `Context: ${String(event.filesIncluded)}/${String(event.filesIndexed)} files, ${String(event.estimatedTokens)}/${String(event.budgetTokens)} tokens\n`,
          ),
        );
        break;
      case "context.compacted":
        process.stderr.write(
          pc.dim(
            `Context compacted: ${String(event.beforeTokens)} -> ${String(event.afterTokens)} tokens\n`,
          ),
        );
        break;
      case "plan.updated":
        if (Array.isArray(event.plan))
          process.stderr.write(pc.blue(`Plan updated: ${String(event.plan.length)} steps\n`));
        break;
      case "plan.incomplete":
        process.stderr.write(
          pc.yellow(`Incomplete plan: ${String(event.remaining)} steps remaining\n`),
        );
        break;
    }
  };
