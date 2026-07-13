import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import type { AlexusConfig } from "../config/schema.js";
import { classifyCommand, type RiskLevel } from "./command-policy.js";

const writes = new Set(["apply_patch", "write_file"]);
export interface ApprovalRequest {
  tool: string;
  command: string;
  args: string[];
  risk: RiskLevel;
  reason: string;
}
export type ApprovalResponse = "once" | "session" | "deny";
export type ApprovalPrompt = (request: ApprovalRequest) => Promise<ApprovalResponse>;
export class ApprovalManager {
  private readonly allowed = new Set<string>();
  constructor(
    private readonly mode: AlexusConfig["approvalMode"],
    private readonly interactive: boolean,
    private readonly json: boolean,
    private readonly prompt?: ApprovalPrompt,
  ) {}
  async evaluate(
    tool: string,
    args: unknown,
  ): Promise<{ allowed: boolean; risk: RiskLevel; reason: string }> {
    if (this.mode === "readonly" && (writes.has(tool) || tool === "run_command"))
      return { allowed: false, risk: "blocked", reason: "modalità readonly" };
    if (tool !== "run_command")
      return {
        allowed: true,
        risk: writes.has(tool) ? "moderate" : "safe",
        reason: "operazione nel workspace",
      };
    const v = args as { command?: unknown; args?: unknown };
    const command = typeof v.command === "string" ? v.command : "";
    const commandArgs =
      Array.isArray(v.args) && v.args.every((x) => typeof x === "string") ? v.args : [];
    const risk = classifyCommand(command, commandArgs);
    if (risk.level === "blocked") return { allowed: false, risk: risk.level, reason: risk.reason };
    if (risk.level === "safe") return { allowed: true, risk: risk.level, reason: risk.reason };
    const key = `${command}\0${commandArgs.join("\0")}`;
    if (this.allowed.has(key)) return { allowed: true, risk: risk.level, reason: risk.reason };
    if (this.prompt) {
      const answer = await this.prompt({
        tool,
        command,
        args: commandArgs,
        risk: risk.level,
        reason: risk.reason,
      });
      if (answer === "session") this.allowed.add(key);
      return { allowed: answer !== "deny", risk: risk.level, reason: risk.reason };
    }
    if (!this.interactive || this.json)
      return { allowed: false, risk: risk.level, reason: `approvazione richiesta: ${risk.reason}` };
    const rl = createInterface({ input: stdin, output: stderr });
    try {
      stderr.write(
        `\nAlexus vuole eseguire: ${command} ${commandArgs.join(" ")}\nMotivo: ${risk.reason}\n[y] una volta  [a] sessione  [n] rifiuta: `,
      );
      const answer = (await rl.question("")).trim().toLowerCase();
      if (answer === "a") this.allowed.add(key);
      return { allowed: answer === "y" || answer === "a", risk: risk.level, reason: risk.reason };
    } finally {
      rl.close();
    }
  }
}
