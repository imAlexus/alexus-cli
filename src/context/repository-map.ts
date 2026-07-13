import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import createIgnore from "ignore";
import { isSensitivePath } from "../security/secret-detector.js";

export interface RepositoryEntry {
  path: string;
  language?: string;
}

const ignored = [
  "**/.git/**",
  "**/.alexus/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.cache/**",
  "**/target/**",
  "**/__pycache__/**",
  "**/AppData/**",
  "**/$RECYCLE.BIN/**",
  "**/System Volume Information/**",
];

const languages: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript React",
  ".js": "JavaScript",
  ".jsx": "JavaScript React",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".cs": "C#",
  ".cpp": "C++",
  ".c": "C",
  ".rb": "Ruby",
  ".php": "PHP",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

export async function buildRepositoryMap(
  root: string,
  respectGitignore = true,
): Promise<RepositoryEntry[]> {
  let files = await fg("**/*", {
    cwd: root,
    onlyFiles: true,
    dot: true,
    ignore: ignored,
    followSymbolicLinks: false,
    suppressErrors: true,
  });
  if (respectGitignore) {
    try {
      const rules = await readFile(path.join(root, ".gitignore"), "utf8");
      const matcher = createIgnore().add(rules);
      files = files.filter((file) => !matcher.ignores(file.replaceAll("\\", "/")));
    } catch {
      // A repository without .gitignore is valid.
    }
  }
  return files
    .filter((file) => !isSensitivePath(file))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 20_000)
    .map((file) => {
      const language = languages[path.extname(file).toLowerCase()];
      return { path: file.replaceAll("\\", "/"), ...(language ? { language } : {}) };
    });
}
