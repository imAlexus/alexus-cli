import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { configSchema, defaultConfig, type AlexusConfig } from "./schema.js";
import { AlexusError } from "../utils/errors.js";

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new AlexusError("CONFIG_INVALID", `Configurazione non valida in ${file}`, false, error);
  }
}

export function projectConfigPath(root: string): string {
  return path.join(root, ".alexus", "config.json");
}
export function globalConfigPath(): string {
  return path.join(homedir(), ".alexus", "config.json");
}

export async function loadConfig(
  root: string,
  flags: Partial<AlexusConfig> = {},
): Promise<AlexusConfig> {
  const [global, project] = await Promise.all([
    readJson(globalConfigPath()),
    readJson(projectConfigPath(root)),
  ]);
  const env: Record<string, unknown> = {};
  if (process.env.ALEXUS_MODEL) env.model = process.env.ALEXUS_MODEL;
  if (process.env.ALEXUS_APPROVAL_MODE) env.approvalMode = process.env.ALEXUS_APPROVAL_MODE;
  const parsed = configSchema.safeParse({
    ...defaultConfig,
    ...global,
    ...project,
    ...env,
    ...flags,
  });
  if (!parsed.success) throw new AlexusError("CONFIG_INVALID", parsed.error.message);
  return parsed.data;
}

export async function saveProjectConfig(root: string, config: AlexusConfig): Promise<void> {
  const file = projectConfigPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export async function initializeWorkspace(root: string): Promise<void> {
  for (const dir of ["sessions", "logs", "cache"])
    await mkdir(path.join(root, ".alexus", dir), { recursive: true });
  try {
    await access(projectConfigPath(root));
  } catch {
    await saveProjectConfig(root, defaultConfig);
  }
  const instructions = path.join(root, "ALEXUS.md");
  try {
    await access(instructions);
  } catch {
    await writeFile(
      instructions,
      "# Alexus project instructions\n\nDescribe project-specific conventions here.\n",
    );
  }
}

export async function isWritable(root: string): Promise<boolean> {
  try {
    await access(root, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
