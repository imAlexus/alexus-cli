import { spawn } from "node:child_process";
import { z } from "zod";
import { classifyCommand } from "../security/command-policy.js";
import { redactSecrets } from "../security/secret-detector.js";
import { AlexusError } from "../utils/errors.js";
import type { ToolDefinition } from "./tool.js";

const schema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).max(100),
    timeoutMs: z.number().int().min(100).max(600_000),
    reason: z.string().min(1),
  })
  .strict();
export const runCommandTool: ToolDefinition<typeof schema> = {
  name: "run_command",
  description: "Esegue un processo senza shell, con argomenti separati, timeout e output limitato.",
  schema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      timeoutMs: { type: "integer", minimum: 100, maximum: 600000 },
      reason: { type: "string" },
    },
    required: ["command", "args", "timeoutMs", "reason"],
  },
  async execute(input, c) {
    const risk = classifyCommand(input.command, input.args);
    if (risk.level === "blocked" || (risk.level === "dangerous" && !c.approvalGranted))
      throw new AlexusError("COMMAND_BLOCKED", `${input.command}: ${risk.reason}`);
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, input.args, {
        cwd: c.workspaceRoot,
        shell: false,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      let stdout = "",
        stderr = "",
        truncated = false,
        timedOut = false;
      const add = (kind: "out" | "err", chunk: Buffer) => {
        const value = redactSecrets(chunk.toString());
        if (stdout.length + stderr.length + value.length > c.maxOutputChars) {
          truncated = true;
          return;
        }
        if (kind === "out") stdout += value;
        else stderr += value;
      };
      child.stdout.on("data", (x: Buffer) => add("out", x));
      child.stderr.on("data", (x: Buffer) => add("err", x));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, input.timeoutMs);
      const abort = () => child.kill();
      c.signal.addEventListener("abort", abort, { once: true });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        c.signal.removeEventListener("abort", abort);
        if (timedOut)
          return reject(
            new AlexusError("COMMAND_TIMEOUT", `Timeout dopo ${input.timeoutMs} ms`, true),
          );
        resolve({
          command: [input.command, ...input.args],
          exitCode: code,
          stdout,
          stderr,
          truncated,
          risk: risk.level,
        });
      });
    });
  },
};
