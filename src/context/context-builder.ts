import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

async function optional(file: string, max = 12000): Promise<string> {
  try {
    return (await readFile(file, "utf8")).slice(0, max);
  } catch {
    return "";
  }
}
export async function buildProjectContext(root: string): Promise<string> {
  const priority = [
    "ALEXUS.md",
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "README.md",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
  ];
  const sections: string[] = [];
  for (const name of priority) {
    const value = await optional(path.join(root, name));
    if (value) sections.push(`## ${name}\n${value}`);
  }
  const files = await fg("**/*", {
    cwd: root,
    onlyFiles: true,
    dot: true,
    deep: 4,
    ignore: [".git/**", "node_modules/**", "dist/**", ".alexus/**", ".env", "**/*.pem", "**/*.key"],
  });
  sections.push(
    `## Repository map\n${files.slice(0, 1000).join("\n")}${files.length > 1000 ? "\n…truncated" : ""}`,
  );
  return sections.join("\n\n");
}
