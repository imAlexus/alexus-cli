import type OpenAI from "openai";
import { estimateTokens, truncateToTokenBudget } from "./token-budget.js";

export interface CompactionResult {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
}

function tokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return estimateTokens(JSON.stringify(messages));
}

function summary(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  return messages
    .map((message) => {
      const content = typeof message.content === "string" ? message.content : "";
      const tools =
        message.role === "assistant" && message.tool_calls?.length
          ? ` tool: ${message.tool_calls
              .map((call) => (call.type === "function" ? call.function.name : "custom"))
              .join(", ")}`
          : "";
      return `${message.role}${tools}: ${truncateToTokenBudget(content, 180)}`;
    })
    .join("\n");
}

export function compactConversation(
  input: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  maxTokens: number,
  force = false,
): CompactionResult {
  const beforeTokens = tokens(input);
  if (!force && beforeTokens <= maxTokens)
    return { messages: input, compacted: false, beforeTokens, afterTokens: beforeTokens };
  const lastUser = input.findLastIndex((message) => message.role === "user");
  const firstSystem = input.find((message) => message.role === "system");
  const prefix = lastUser > 0 ? input.slice(firstSystem ? 1 : 0, lastUser) : [];
  const tail = lastUser >= 0 ? input.slice(lastUser) : input.slice(-8);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...(firstSystem ? [firstSystem] : []),
    ...(prefix.length
      ? [
          {
            role: "system" as const,
            content: `Riepilogo compatto della conversazione precedente:\n${truncateToTokenBudget(summary(prefix), Math.max(500, Math.floor(maxTokens * 0.2)))}`,
          },
        ]
      : []),
    ...tail,
  ].map((message, index, all) => {
    if (
      index < all.length - 2 &&
      message.role === "tool" &&
      typeof message.content === "string" &&
      estimateTokens(message.content) > 800
    )
      return { ...message, content: truncateToTokenBudget(message.content, 800) };
    return message;
  });
  return { messages, compacted: true, beforeTokens, afterTokens: tokens(messages) };
}
