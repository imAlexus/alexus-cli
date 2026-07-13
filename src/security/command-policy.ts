export type RiskLevel = "safe" | "moderate" | "dangerous" | "blocked";
export interface CommandRisk {
  level: RiskLevel;
  reason: string;
}

const blocked = /\b(?:format|diskpart|shutdown|reboot|mkfs|reg\s+delete)\b/i;
const destructive =
  /(?:\brm\b.*\s-rf\b|\bdel\b.*\/s|\brmdir\b.*\/s|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f)|docker\s+system\s+prune|npm\s+publish|git\s+push|\bsudo\b|\bdd\b|Remove-Item.*-Recurse)/i;
const complex =
  /(?:\||&&|\|\||[<>]|\$\(|`|\bpowershell\b|\bcmd\b\s*\/c|\bcurl\b|\bwget\b|\bssh\b)/i;
const moderate =
  /\b(?:npm|pnpm|yarn)\s+(?:install|add)|\bpip\s+install|\bcargo\s+add|\bgit\s+commit|\bdocker\s+build/i;
const safe =
  /^(?:npm|pnpm|yarn)\s+(?:test|run\s+(?:test|lint|build|typecheck|check)|exec\s+tsc)|^(?:git\s+(?:status|diff|show)|npx\s+tsc\s+--noEmit|tsc\s+--noEmit|pytest(?:\s|$)|cargo\s+test(?:\s|$)|go\s+test(?:\s|$))/i;

export function classifyCommand(command: string, args: readonly string[]): CommandRisk {
  const full = [command, ...args].join(" ").trim();
  if (blocked.test(full)) return { level: "blocked", reason: "operazione di sistema bloccata" };
  if (destructive.test(full))
    return { level: "dangerous", reason: "operazione distruttiva o di pubblicazione" };
  if (complex.test(full)) return { level: "dangerous", reason: "shell, rete o sintassi complessa" };
  if (moderate.test(full))
    return { level: "moderate", reason: "modifica dipendenze o stato esterno" };
  if (safe.test(full))
    return { level: "safe", reason: "comando di verifica o Git in sola lettura" };
  return { level: "moderate", reason: "eseguibile non riconosciuto" };
}
