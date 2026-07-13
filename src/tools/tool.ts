import type { z } from "zod";
import type { SessionStore } from "../sessions/sqlite-store.js";
import type { EventBus } from "../protocol/event-bus.js";

export interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  store: SessionStore;
  events: EventBus;
  signal: AbortSignal;
  maxOutputChars: number;
  approvalGranted?: boolean;
  toolCallId?: string;
}
export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: T;
  parameters: Record<string, unknown>;
  execute(input: z.infer<T>, context: ToolContext): Promise<unknown>;
}
export interface RequestedToolCall {
  id: string;
  name: string;
  arguments: string;
}
