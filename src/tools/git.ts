import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "./tool.js";
async function git(
  root: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd: root, shell: false, windowsHide: true });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (x) => (stdout += String(x)));
    p.stderr.on("data", (x) => (stderr += String(x)));
    p.on("error", reject);
    p.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}
const statusSchema = z.object({}).strict();
export const gitStatusTool: ToolDefinition<typeof statusSchema> = {
  name: "git_status",
  description: "Mostra lo stato Git strutturato.",
  schema: statusSchema,
  parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  async execute(_, c) {
    const r = await git(c.workspaceRoot, ["status", "--short", "--branch"]);
    return { ...r, lines: r.stdout.split(/\r?\n/).filter(Boolean) };
  },
};
const diffSchema = z
  .object({
    path: z.string().optional(),
    staged: z.boolean().default(false),
    stat: z.boolean().default(false),
  })
  .strict();
export const gitDiffTool: ToolDefinition<typeof diffSchema> = {
  name: "git_diff",
  description: "Mostra diff Git completo, staged, statistiche o di un file.",
  schema: diffSchema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string" },
      staged: { type: "boolean" },
      stat: { type: "boolean" },
    },
    required: ["staged", "stat"],
  },
  async execute(input, c) {
    const args = [
      "diff",
      ...(input.staged ? ["--cached"] : []),
      ...(input.stat ? ["--stat"] : []),
      ...(input.path ? ["--", input.path] : []),
    ];
    return git(c.workspaceRoot, args);
  },
};
