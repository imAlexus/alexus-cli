import { readFile } from "node:fs/promises";
import {
  detectProject,
  formatProjectProfile,
  type ProjectProfile,
} from "../project/project-detector.js";
import { resolveSafeExistingPath } from "../security/path-policy.js";
import { redactSecrets } from "../security/secret-detector.js";
import { rankRepositoryFiles, type RankedFile } from "./file-ranker.js";
import { buildRepositoryMap } from "./repository-map.js";
import { ContextBudget } from "./token-budget.js";

export interface ContextStats {
  filesIndexed: number;
  filesIncluded: number;
  estimatedTokens: number;
  budgetTokens: number;
  truncated: boolean;
}

export interface ProjectContextReport {
  content: string;
  stats: ContextStats;
  rankedFiles: RankedFile[];
  profile: ProjectProfile;
}

async function optional(root: string, relative: string): Promise<string> {
  try {
    const file = await resolveSafeExistingPath(root, relative);
    const data = await readFile(file);
    if (data.subarray(0, 8000).includes(0)) return "";
    return redactSecrets(data.toString("utf8"));
  } catch {
    return "";
  }
}

export async function buildProjectContextReport(
  root: string,
  task = "",
  maxContextTokens = 120_000,
  respectGitignore = true,
): Promise<ProjectContextReport> {
  const contextLimit = Math.max(800, Math.min(30_000, Math.floor(maxContextTokens * 0.3)));
  const budget = new ContextBudget(contextLimit);
  const profile = await detectProject(root);
  const repository = await buildRepositoryMap(root, respectGitignore);
  const rankedFiles = rankRepositoryFiles(repository, task);
  budget.add("Profilo progetto", formatProjectProfile(profile), 1_000);

  const priority = [
    "ALEXUS.md",
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    ".env.example",
    "README.md",
  ];
  const included = new Set<string>();
  for (const name of priority) {
    const value = await optional(root, name);
    if (value && budget.add(name, value, name === "ALEXUS.md" ? 4_000 : 2_500)) included.add(name);
  }

  budget.add(
    "Repository map",
    rankedFiles
      .slice(0, 1_500)
      .map((entry) => `${entry.path}${entry.language ? ` [${entry.language}]` : ""}`)
      .join("\n"),
    4_000,
  );
  for (const entry of rankedFiles.filter((file) => file.score > 3).slice(0, 10)) {
    if (included.has(entry.path)) continue;
    const value = await optional(root, entry.path);
    if (value && budget.add(`File rilevante: ${entry.path}`, value, 1_800))
      included.add(entry.path);
  }
  const result = budget.result();
  return {
    content: result.content,
    stats: {
      filesIndexed: repository.length,
      filesIncluded: included.size,
      estimatedTokens: result.usedTokens,
      budgetTokens: result.maxTokens,
      truncated: result.truncated,
    },
    rankedFiles: rankedFiles.slice(0, 50),
    profile,
  };
}

export async function buildProjectContext(root: string): Promise<string> {
  return (await buildProjectContextReport(root)).content;
}
