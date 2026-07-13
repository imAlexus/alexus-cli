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
    }
  };
