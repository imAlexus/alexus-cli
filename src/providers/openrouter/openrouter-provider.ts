import OpenAI from "openai";
import { createOpenRouterClient } from "./client.js";
import { AlexusError } from "../../utils/errors.js";
import type { GenerateInput, Provider, ProviderResponse } from "../provider.js";

export class OpenRouterProvider implements Provider {
  private readonly client: OpenAI;
  constructor(client?: OpenAI) {
    this.client = client ?? createOpenRouterClient();
  }
  async generate(input: GenerateInput): Promise<ProviderResponse> {
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: input.model,
          messages: input.messages,
          tools: input.tools,
          tool_choice: "auto",
          temperature: input.temperature,
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: input.signal },
      );
      let text = "";
      const calls = new Map<number, { id: string; name: string; arguments: string }>();
      let usage: ProviderResponse["usage"];
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          input.onText?.(delta.content);
        }
        for (const call of delta?.tool_calls ?? []) {
          const item = calls.get(call.index) ?? { id: "", name: "", arguments: "" };
          if (call.id) item.id = call.id;
          if (call.function?.name) item.name += call.function.name;
          if (call.function?.arguments) item.arguments += call.function.arguments;
          calls.set(call.index, item);
        }
        if (chunk.usage) {
          const raw = chunk.usage as typeof chunk.usage & { cost?: number };
          usage = {
            promptTokens: raw.prompt_tokens,
            completionTokens: raw.completion_tokens,
            ...(typeof raw.cost === "number" ? { cost: raw.cost } : {}),
          };
        }
      }
      const toolCalls = [...calls.values()];
      const message: OpenAI.Chat.Completions.ChatCompletionMessage = {
        role: "assistant",
        content: text || null,
        refusal: null,
        ...(toolCalls.length
          ? {
              tool_calls: toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      };
      return { message, text, toolCalls, ...(usage ? { usage } : {}) };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401)
        throw new AlexusError("OPENROUTER_AUTH_ERROR", "Chiave OpenRouter non valida.");
      if (status === 429)
        throw new AlexusError("OPENROUTER_RATE_LIMIT", "Rate limit OpenRouter raggiunto.", true);
      throw new AlexusError(
        "OPENROUTER_PROVIDER_ERROR",
        error instanceof Error ? error.message : String(error),
        true,
        error,
      );
    }
  }
}
