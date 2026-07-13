import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { AlexusError } from "../utils/errors.js";

function within(root: string, candidate: string): boolean {
  const normalize = (value: string): string =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const r = normalize(path.resolve(root));
  const c = normalize(path.resolve(candidate));
  return c === r || c.startsWith(`${r}${path.sep}`);
}

export function resolveWorkspacePath(root: string, requested: string): string {
  if (
    !requested ||
    path.isAbsolute(requested) ||
    /^[a-zA-Z]:[\\/]/.test(requested) ||
    requested.includes("\0") ||
    /^\\\\/.test(requested)
  )
    throw new AlexusError("PATH_OUTSIDE_WORKSPACE", `Percorso vietato: ${requested}`);
  const resolved = path.resolve(root, requested);
  if (!within(root, resolved))
    throw new AlexusError(
      "PATH_OUTSIDE_WORKSPACE",
      `Accesso fuori dal workspace vietato: ${requested}`,
    );
  return resolved;
}

export async function resolveSafeExistingPath(root: string, requested: string): Promise<string> {
  const resolved = resolveWorkspacePath(root, requested);
  const [realRoot, realResolved] = await Promise.all([realpath(root), realpath(resolved)]);
  if (!within(realRoot, realResolved))
    throw new AlexusError("PATH_OUTSIDE_WORKSPACE", `Symlink esterno vietato: ${requested}`);
  const stat = await lstat(realResolved);
  if (!stat.isFile() && !stat.isDirectory())
    throw new AlexusError("PATH_OUTSIDE_WORKSPACE", `Tipo di file speciale vietato: ${requested}`);
  return realResolved;
}

export async function assertSafeWritePath(root: string, requested: string): Promise<string> {
  const resolved = resolveWorkspacePath(root, requested);
  let parent = path.dirname(resolved);
  while (parent !== path.dirname(parent)) {
    try {
      parent = await realpath(parent);
      break;
    } catch {
      parent = path.dirname(parent);
    }
  }
  const realRoot = await realpath(root);
  if (!within(realRoot, parent))
    throw new AlexusError("PATH_OUTSIDE_WORKSPACE", `Destinazione esterna vietata: ${requested}`);
  return resolved;
}
