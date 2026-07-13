import OpenAI from "openai";
import { AlexusError } from "../../utils/errors.js";
export function createOpenRouterClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey)
    throw new AlexusError(
      "API_KEY_MISSING",
      "Imposta OPENROUTER_API_KEY prima di avviare un task.",
    );
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/alexus-cli/alexus",
      "X-Title": "Alexus CLI",
    },
  });
}
