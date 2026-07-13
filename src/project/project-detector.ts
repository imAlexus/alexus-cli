import { access, readFile } from "node:fs/promises";
import path from "node:path";

export type VerificationKind = "format" | "lint" | "typecheck" | "test" | "build";

export interface VerificationCommand {
  kind: VerificationKind;
  command: string;
  args: string[];
  label: string;
}

export interface ProjectProfile {
  ecosystems: string[];
  frameworks: string[];
  packageManager?: string;
  verificationCommands: VerificationCommand[];
}

async function exists(root: string, name: string): Promise<boolean> {
  try {
    await access(path.join(root, name));
    return true;
  } catch {
    return false;
  }
}

async function text(root: string, name: string): Promise<string> {
  try {
    return await readFile(path.join(root, name), "utf8");
  } catch {
    return "";
  }
}

function scriptCommand(
  manager: string,
  scripts: Record<string, unknown>,
  kind: VerificationKind,
  candidates: string[],
): VerificationCommand | undefined {
  const script = candidates.find((name) => {
    const value = scripts[name];
    return typeof value === "string" && !/no test specified/i.test(value);
  });
  return script
    ? { kind, command: manager, args: ["run", script], label: `${manager} run ${script}` }
    : undefined;
}

export async function detectProject(root: string): Promise<ProjectProfile> {
  const ecosystems: string[] = [];
  const frameworks: string[] = [];
  const verificationCommands: VerificationCommand[] = [];
  let packageManager: string | undefined;
  const packageText = await text(root, "package.json");

  if (packageText) {
    ecosystems.push("Node.js");
    let manifest: {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      packageManager?: string;
    } = {};
    try {
      manifest = JSON.parse(packageText) as typeof manifest;
    } catch {
      // The config loader will surface malformed project files when they are used.
    }
    packageManager = (await exists(root, "pnpm-lock.yaml"))
      ? "pnpm"
      : (await exists(root, "yarn.lock"))
        ? "yarn"
        : (await exists(root, "bun.lockb")) || (await exists(root, "bun.lock"))
          ? "bun"
          : manifest.packageManager?.split("@")[0] || "npm";
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [dependency, framework] of [
      ["next", "Next.js"],
      ["react", "React"],
      ["vue", "Vue"],
      ["@angular/core", "Angular"],
      ["svelte", "Svelte"],
      ["express", "Express"],
      ["fastify", "Fastify"],
      ["@nestjs/core", "NestJS"],
    ] as const) {
      if (dependency in dependencies) frameworks.push(framework);
    }
    const scripts = manifest.scripts ?? {};
    for (const command of [
      scriptCommand(packageManager, scripts, "format", [
        "format:check",
        "format-check",
        "prettier:check",
      ]),
      scriptCommand(packageManager, scripts, "lint", ["lint"]),
      scriptCommand(packageManager, scripts, "typecheck", [
        "typecheck",
        "type-check",
        "check:types",
      ]),
      scriptCommand(packageManager, scripts, "test", ["test"]),
      scriptCommand(packageManager, scripts, "build", ["build"]),
    ]) {
      if (command) verificationCommands.push(command);
    }
  }

  const pyproject = await text(root, "pyproject.toml");
  if (pyproject) {
    ecosystems.push("Python");
    if (/\bpytest\b/i.test(pyproject))
      verificationCommands.push({
        kind: "test",
        command: "python",
        args: ["-m", "pytest"],
        label: "python -m pytest",
      });
  }
  if (await exists(root, "Cargo.toml")) {
    ecosystems.push("Rust");
    verificationCommands.push({
      kind: "test",
      command: "cargo",
      args: ["test"],
      label: "cargo test",
    });
  }
  if (await exists(root, "go.mod")) {
    ecosystems.push("Go");
    verificationCommands.push({
      kind: "test",
      command: "go",
      args: ["test", "./..."],
      label: "go test ./...",
    });
  }

  return {
    ecosystems,
    frameworks,
    ...(packageManager ? { packageManager } : {}),
    verificationCommands: verificationCommands.filter(
      (command, index, all) =>
        all.findIndex((candidate) => candidate.label === command.label) === index,
    ),
  };
}

export function formatProjectProfile(profile: ProjectProfile): string {
  return [
    `Ecosistemi: ${profile.ecosystems.join(", ") || "non rilevati"}`,
    `Framework: ${profile.frameworks.join(", ") || "non rilevati"}`,
    ...(profile.packageManager ? [`Package manager: ${profile.packageManager}`] : []),
    `Verifiche disponibili: ${profile.verificationCommands.map((command) => command.label).join(", ") || "nessuna"}`,
  ].join("\n");
}
