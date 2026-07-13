import { AlexusError } from "../utils/errors.js";
import type { RequestedToolCall, ToolContext, ToolDefinition } from "./tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  register(tool: ToolDefinition): this {
    this.tools.set(tool.name, tool);
    return this;
  }
  definitions(): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return [...this.tools.values()].map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  async execute(call: RequestedToolCall, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(call.name);
    if (!tool) throw new AlexusError("TOOL_VALIDATION_FAILED", `Tool sconosciuto: ${call.name}`);
    let raw: unknown;
    try {
      raw = JSON.parse(call.arguments);
    } catch {
      throw new AlexusError("TOOL_VALIDATION_FAILED", `JSON non valido per ${call.name}`);
    }
    const parsed = tool.schema.safeParse(raw);
    if (!parsed.success) throw new AlexusError("TOOL_VALIDATION_FAILED", parsed.error.message);
    return tool.execute(parsed.data, context);
  }
}
