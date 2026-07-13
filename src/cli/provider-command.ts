import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { credentialsPath, providerApiKey, saveProviderApiKey } from "../config/credentials.js";

export const PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Accesso a modelli OpenAI, Anthropic, Google e altri tramite una sola API",
  },
] as const;

export function printProviders(): void {
  for (const [index, provider] of PROVIDERS.entries())
    console.log(
      `${index + 1}. ${provider.name} (${provider.id})${providerApiKey(provider.id) ? " — configurato" : ""}\n   ${provider.description}`,
    );
}

async function promptMasked(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function")
    throw new Error("Serve un terminale interattivo per inserire la chiave API.");
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
          reject(new Error("Configurazione annullata."));
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
    console.log("Provider disponibili:\n");
    printProviders();
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question("\nScegli un provider [1]: ")).trim();
      selected = answer || "1";
    } finally {
      rl.close();
    }
  }
  const provider = PROVIDERS.find(
    (candidate, index) => candidate.id === selected || String(index + 1) === selected,
  );
  if (!provider)
    throw new Error(`Provider non supportato: ${selected}. Usa "alexus provider list".`);
  const apiKey = (await promptMasked(`Chiave API ${provider.name}: `)).trim();
  if (apiKey.length < 12) throw new Error("La chiave API inserita non sembra valida.");
  await saveProviderApiKey(provider.id, apiKey);
  if (provider.id === "openrouter") process.env.OPENROUTER_API_KEY = apiKey;
  console.log(`${provider.name} configurato. Credenziali salvate in ${credentialsPath()}`);
}
