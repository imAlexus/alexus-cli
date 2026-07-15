import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRepositoryMap } from "../src/context/repository-map.js";
import { rankRepositoryFiles } from "../src/context/file-ranker.js";
import { buildProjectContextReport } from "../src/context/context-builder.js";
import { compactConversation } from "../src/context/compactor.js";
import { estimateTokens, truncateToTokenBudget } from "../src/context/token-budget.js";
import type OpenAI from "openai";

const roots: string[] = [];
async function root(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), "alexus-context-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true });
});

describe("repository context", () => {
  it("respects ignore rules and ranks task-related paths", async () => {
    const workspace = await root();
    await mkdir(path.join(workspace, "src", "auth"), { recursive: true });
    await mkdir(path.join(workspace, "AppData", "Local", "Temp", "blocked"), {
      recursive: true,
    });
    await writeFile(path.join(workspace, ".gitignore"), "ignored.ts\n");
    await writeFile(path.join(workspace, "ignored.ts"), "ignored");
    await writeFile(path.join(workspace, ".env"), "SECRET=value");
    await writeFile(path.join(workspace, "src", "auth", "login.ts"), "export const login = true;");
    await writeFile(path.join(workspace, "src", "other.ts"), "export const other = true;");
    await writeFile(
      path.join(workspace, "AppData", "Local", "Temp", "blocked", "system.tmp"),
      "not project context",
    );

    const repository = await buildRepositoryMap(workspace, true);
    expect(repository.map((entry) => entry.path)).toEqual([
      ".gitignore",
      "src/auth/login.ts",
      "src/other.ts",
    ]);
    const ranked = rankRepositoryFiles(repository, "fix the auth login");
    expect(ranked[0]?.path).toBe("src/auth/login.ts");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("builds a task-aware context inside its token budget", async () => {
    const workspace = await root();
    await mkdir(path.join(workspace, "src", "auth"), { recursive: true });
    await writeFile(path.join(workspace, "ALEXUS.md"), "Segui le convenzioni del progetto.");
    await writeFile(path.join(workspace, "package.json"), JSON.stringify({ scripts: {} }));
    await writeFile(
      path.join(workspace, ".env.example"),
      "OPENROUTER_API_KEY=sk-or-v1-exampletoken123456789\n",
    );
    await writeFile(
      path.join(workspace, "src", "auth", "login.ts"),
      "export function login() { return false; }\n",
    );

    const report = await buildProjectContextReport(workspace, "fix login", 10_000, true);
    expect(report.stats.estimatedTokens).toBeLessThanOrEqual(report.stats.budgetTokens);
    expect(report.content).toContain("Segui le convenzioni");
    expect(report.content).toContain("[REDACTED]");
    expect(report.content).not.toContain("sk-or-v1-exampletoken123456789");
    expect(report.content).toContain("File rilevante: src/auth/login.ts");
    expect(report.rankedFiles[0]?.path).toBe("src/auth/login.ts");
  });
});

describe("token budget and compaction", () => {
  it("truncates UTF-8 content to an approximate token budget", () => {
    const value = "è".repeat(10_000);
    const truncated = truncateToTokenBudget(value, 200);
    expect(estimateTokens(truncated)).toBeLessThanOrEqual(200);
    expect(truncated).toContain("troncato");
  });

  it("summarizes previous turns while preserving the active tool sequence", () => {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: "instructions" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer".repeat(2_000) },
      { role: "user", content: "current question" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "result" },
    ];
    const compacted = compactConversation(messages, 1_000, true);
    expect(compacted.compacted).toBe(true);
    expect(compacted.afterTokens).toBeLessThan(compacted.beforeTokens);
    expect(
      compacted.messages.some(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes("Riepilogo"),
      ),
    ).toBe(true);
    expect(compacted.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });
});
