import type OpenAI from "openai";
export interface ProviderResponse {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  usage?: { promptTokens: number; completionTokens: number; cost?: number };
}
export interface GenerateInput {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  temperature: number;
  signal: AbortSignal;
  onText?: (delta: string) => void;
}
export interface Provider {
  generate(input: GenerateInput): Promise<ProviderResponse>;
}
