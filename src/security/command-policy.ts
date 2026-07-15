export type RiskLevel = "safe" | "moderate" | "dangerous" | "blocked";
export interface CommandRisk {
  level: RiskLevel;
  reason: string;
}

const blocked = /^(?:(?:format|diskpart|shutdown|reboot|mkfs|dd)(?:\s|$)|reg\s+delete\b)/i;
const destructive =
  /(?:\brm\b.*\s-rf\b|\bdel\b.*\/s|\brmdir\b.*\/s|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|docker\s+system\s+prune|npm\s+publish|git\s+push|\bsudo\b|\bdd\b|Remove-Item.*-Recurse)/i;
const complex =
  /(?:\||&&|\|\||[<>]|\$\(|`|\bpowershell\b|\bcmd\b\s*\/c|\bcurl\b|\bwget\b|\bssh\b)/i;
const moderate =
  /\b(?:npm|pnpm|yarn)\s+(?:install|add)|\bpip\s+install|\bcargo\s+add|\bgit\s+commit|\bdocker\s+build/i;
const safe =
  /^(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test|lint|build|typecheck|type-check|check:types|format:check|format-check|prettier:check)|exec\s+tsc)|^(?:git\s+(?:status|diff|show)|npx\s+tsc\s+--noEmit|tsc\s+--noEmit|python\s+-m\s+pytest(?:\s|$)|pytest(?:\s|$)|cargo\s+test(?:\s|$)|go\s+test(?:\s|$))/i;

export function classifyCommand(command: string, args: readonly string[]): CommandRisk {
  const full = [command, ...args].join(" ").trim();
  if (blocked.test(full)) return { level: "blocked", reason: "blocked system operation" };
  if (destructive.test(full))
    return { level: "dangerous", reason: "destructive or publishing operation" };
  if (complex.test(full))
    return { level: "dangerous", reason: "shell, network, or complex syntax" };
  if (moderate.test(full))
    return { level: "moderate", reason: "changes dependencies or external state" };
  if (safe.test(full)) return { level: "safe", reason: "verification or read-only Git command" };
  return { level: "moderate", reason: "unrecognized executable" };
}
