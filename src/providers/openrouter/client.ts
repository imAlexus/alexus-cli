import OpenAI from "openai";
import { AlexusError } from "../../utils/errors.js";
import { providerApiKey } from "../../config/credentials.js";
export function createOpenRouterClient(): OpenAI {
  const apiKey = providerApiKey("openrouter");
  if (!apiKey)
    throw new AlexusError(
      "API_KEY_MISSING",
      'Configure OpenRouter with "alexus provider" or set OPENROUTER_API_KEY.',
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
