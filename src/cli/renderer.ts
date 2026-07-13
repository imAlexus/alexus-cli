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
            pc.dim(`Costo stimato: $${Number(event.estimatedCost).toFixed(4)}\n`),
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
          process.stderr.write(pc.dim(`Verifiche automatiche: ${commands.join(", ")}\n`));
        break;
      }
      case "command.output":
        if (typeof event.text === "string")
          (event.stream === "stderr" ? process.stderr : process.stdout).write(event.text);
        break;
      case "context.built":
        process.stderr.write(
          pc.dim(
            `Contesto: ${String(event.filesIncluded)}/${String(event.filesIndexed)} file, ${String(event.estimatedTokens)}/${String(event.budgetTokens)} token\n`,
          ),
        );
        break;
      case "context.compacted":
        process.stderr.write(
          pc.dim(
            `Contesto compattato: ${String(event.beforeTokens)} -> ${String(event.afterTokens)} token\n`,
          ),
        );
        break;
      case "plan.updated":
        if (Array.isArray(event.plan))
          process.stderr.write(pc.blue(`Piano aggiornato: ${String(event.plan.length)} step\n`));
        break;
      case "plan.incomplete":
        process.stderr.write(
          pc.yellow(`Piano incompleto: ${String(event.remaining)} step rimanenti\n`),
        );
        break;
    }
  };
