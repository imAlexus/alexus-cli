import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { AlexusError } from "../utils/errors.js";

interface CredentialsFile {
  providers?: Record<string, { apiKey?: string }>;
}

export function credentialsPath(): string {
  return path.join(process.env.ALEXUS_HOME ?? path.join(homedir(), ".alexus"), "credentials.json");
}

function parseCredentials(content: string): CredentialsFile {
  try {
    return JSON.parse(content) as CredentialsFile;
  } catch (error) {
    throw new AlexusError(
      "CONFIG_INVALID",
      `Invalid credentials in ${credentialsPath()}`,
      false,
      error,
    );
  }
}

export function providerApiKey(provider: string): string | undefined {
  try {
    const stored = parseCredentials(readFileSync(credentialsPath(), "utf8")).providers?.[provider]
      ?.apiKey;
    if (stored) return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return provider === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined;
}

export async function saveProviderApiKey(provider: string, apiKey: string): Promise<void> {
  const file = credentialsPath();
  let credentials: CredentialsFile = {};
  try {
    credentials = parseCredentials(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  credentials.providers = {
    ...credentials.providers,
    [provider]: { apiKey },
  };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}
