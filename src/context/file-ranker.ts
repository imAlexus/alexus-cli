import path from "node:path";
import type { RepositoryEntry } from "./repository-map.js";

export interface RankedFile extends RepositoryEntry {
  score: number;
  reasons: string[];
}

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "nel",
  "nella",
  "della",
  "delle",
  "con",
  "per",
  "che",
  "una",
  "uno",
  "gli",
  "del",
  "dei",
  "correggi",
  "modifica",
  "fix",
]);
const priority = new Set([
  "alexus.md",
  "package.json",
  "pyproject.toml",
  "cargo.toml",
  "go.mod",
  "tsconfig.json",
]);

export function taskTerms(task: string): string[] {
  return [...new Set(task.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) ?? [])].filter(
    (term) => !stopWords.has(term),
  );
}

export function rankRepositoryFiles(entries: RepositoryEntry[], task: string): RankedFile[] {
  const terms = taskTerms(task);
  const asksForTests = terms.some((term) => term.startsWith("test"));
  return entries
    .map((entry) => {
      const normalized = entry.path.toLowerCase();
      const basename = path.basename(normalized);
      const reasons: string[] = [];
      let score = 0;
      if (priority.has(basename)) {
        score += 20;
        reasons.push("configurazione prioritaria");
      }
      for (const term of terms) {
        if (basename.includes(term)) {
          score += 24;
          reasons.push(`nome:${term}`);
        } else if (normalized.includes(term)) {
          score += 12;
          reasons.push(`percorso:${term}`);
        }
      }
      if (/^(?:src|app|lib)[/\\]/.test(normalized)) score += 3;
      if (asksForTests && /(?:test|spec)/.test(normalized)) score += 6;
      if (entry.language) score += 1;
      return { ...entry, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
