import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { credentialsPath, providerApiKey, saveProviderApiKey } from "../config/credentials.js";

export const PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Access OpenAI, Anthropic, Google, and other models through one API",
  },
] as const;

export function printProviders(): void {
  for (const [index, provider] of PROVIDERS.entries())
    console.log(
      `${index + 1}. ${provider.name} (${provider.id})${providerApiKey(provider.id) ? " — configured" : ""}\n   ${provider.description}`,
    );
}

async function promptMasked(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function")
    throw new Error("An interactive terminal is required to enter the API key.");
  stdout.write(label);
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: Buffer) => {
      const input = chunk.toString("utf8");
      if (input.startsWith("\u001b")) return;
      for (const character of input) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Setup cancelled."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          stdout.write("•");
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

export async function configureProvider(providerId?: string): Promise<void> {
  let selected = providerId?.toLowerCase();
  if (!selected) {
    console.log("Available providers:\n");
    printProviders();
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question("\nChoose a provider [1]: ")).trim();
      selected = answer || "1";
    } finally {
      rl.close();
    }
  }
  const provider = PROVIDERS.find(
    (candidate, index) => candidate.id === selected || String(index + 1) === selected,
  );
  if (!provider) throw new Error(`Unsupported provider: ${selected}. Run "alexus provider list".`);
  const existing = providerApiKey(provider.id);
  const apiKey = (
    await promptMasked(
      `${provider.name} API key${existing ? " (press Enter to keep the existing key)" : ""}: `,
    )
  ).trim();
  if (!apiKey && existing) {
    console.log(`${provider.name}: existing key kept. Open Alexus and use /model.`);
    return;
  }
  if (apiKey.length < 12) throw new Error("The API key does not appear to be valid.");
  await saveProviderApiKey(provider.id, apiKey);
  if (provider.id === "openrouter") process.env.OPENROUTER_API_KEY = apiKey;
  console.log(
    `${provider.name} configured. Credentials saved to ${credentialsPath()}. Open Alexus and use /model.`,
  );
}
