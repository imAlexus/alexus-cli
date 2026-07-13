import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AlexusModel } from "./types.js";
import { AlexusError } from "../../utils/errors.js";

const TTL = 60 * 60 * 1000;
export async function listModels(root: string, refresh = false): Promise<AlexusModel[]> {
  const cache = path.join(root, ".alexus", "cache", "models.json");
  if (!refresh) {
    try {
      const saved = JSON.parse(await readFile(cache, "utf8")) as {
        at: number;
        data: AlexusModel[];
      };
      if (Date.now() - saved.at < TTL) return saved.data;
    } catch {
      /* refresh */
    }
  }
  const key = process.env.OPENROUTER_API_KEY;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!response.ok)
    throw new AlexusError(
      "OPENROUTER_PROVIDER_ERROR",
      `Impossibile recuperare i modelli (${response.status})`,
      true,
    );
  const raw = (await response.json()) as { data: Array<Record<string, unknown>> };
  const data = raw.data.map((m) => ({
    id: String(m.id),
    name: String(m.name ?? m.id),
    contextLength: Number(m.context_length ?? 0),
    pricing: (m.pricing ?? {}) as Record<string, string>,
    supportedParameters: Array.isArray(m.supported_parameters)
      ? m.supported_parameters.map(String)
      : [],
    tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
  }));
  await mkdir(path.dirname(cache), { recursive: true });
  await writeFile(cache, JSON.stringify({ at: Date.now(), data }));
  return data;
}
export async function assertToolModel(root: string, id: string): Promise<void> {
  const model = (await listModels(root)).find((m) => m.id === id);
  if (!model) throw new AlexusError("MODEL_NOT_FOUND", `Modello OpenRouter non trovato: ${id}`);
  if (!model.tools)
    throw new AlexusError(
      "MODEL_TOOL_CALLING_UNSUPPORTED",
      `${id} non dichiara supporto tool calling. Seleziona un modello mostrato da "alexus model list --tools".`,
    );
}
