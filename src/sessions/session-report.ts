import { redactSecrets } from "../security/secret-detector.js";
import type { SessionStore, StoredPlan, StoredSession } from "./sqlite-store.js";

export interface VerificationRunReport {
  command: string;
  status: string;
  exitCode: number | null;
}
export interface SessionReport {
  session: StoredSession;
  plan?: StoredPlan;
  changedFiles: string[];
  diff: string;
  insertions: number;
  deletions: number;
  verificationRuns: VerificationRunReport[];
  usage: { promptTokens: number; completionTokens: number; estimatedCost: number };
  rememberedApprovals: number;
}

function diffStats(diff: string): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) insertions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { insertions, deletions };
}

export async function buildSessionReport(
  store: SessionStore,
  sessionId: string,
): Promise<SessionReport> {
  const session = store.get(sessionId);
  if (!session) throw new Error("Session not found");
  const diff = redactSecrets(await store.diff(sessionId));
  const stats = diffStats(diff);
  const toolRows = store.db
    .prepare(
      "SELECT arguments_json,result_json,status FROM tool_runs WHERE session_id=? AND tool_name='run_command' ORDER BY started_at,rowid",
    )
    .all(sessionId) as Array<{
    arguments_json: string;
    result_json: string | null;
    status: string;
  }>;
  const verificationRuns = toolRows.map((row) => {
    const args = JSON.parse(row.arguments_json) as { command?: unknown; args?: unknown };
    const payload = row.result_json ? (JSON.parse(row.result_json) as unknown) : undefined;
    const result = payload as { result?: { exitCode?: unknown }; exitCode?: unknown } | undefined;
    const exitCodeValue = result?.result?.exitCode ?? result?.exitCode;
    const commandArgs = Array.isArray(args.args)
      ? args.args.filter((value): value is string => typeof value === "string")
      : [];
    return {
      command: redactSecrets(
        [typeof args.command === "string" ? args.command : "", ...commandArgs].join(" ").trim(),
      ),
      status: row.status,
      exitCode: typeof exitCodeValue === "number" ? exitCodeValue : null,
    };
  });
  const usageRows = store.db
    .prepare(
      `SELECT i.payload_json FROM items i JOIN turns t ON t.id=i.turn_id
       WHERE t.session_id=? AND i.type='usage'`,
    )
    .all(sessionId) as Array<{ payload_json: string }>;
  const usage = usageRows.reduce(
    (total, row) => {
      const value = JSON.parse(row.payload_json) as Record<string, unknown>;
      total.promptTokens += typeof value.promptTokens === "number" ? value.promptTokens : 0;
      total.completionTokens +=
        typeof value.completionTokens === "number" ? value.completionTokens : 0;
      total.estimatedCost += typeof value.estimatedCost === "number" ? value.estimatedCost : 0;
      return total;
    },
    { promptTokens: 0, completionTokens: 0, estimatedCost: 0 },
  );
  const plan = store.plan(sessionId);
  return {
    session,
    ...(plan ? { plan } : {}),
    changedFiles: store.changedFiles(sessionId),
    diff,
    ...stats,
    verificationRuns,
    usage,
    rememberedApprovals: store.approvals(sessionId).length,
  };
}

export function formatSessionReport(report: SessionReport): string {
  return [
    `${report.session.id} · ${report.session.status} · ${report.session.model}`,
    `Files: ${report.changedFiles.length} · +${report.insertions} -${report.deletions}`,
    `Checks: ${report.verificationRuns.filter((run) => run.exitCode === 0).length}/${report.verificationRuns.length}`,
    `Tokens: ${report.usage.promptTokens} in / ${report.usage.completionTokens} out · $${report.usage.estimatedCost.toFixed(4)}`,
    `Remembered approvals: ${report.rememberedApprovals}`,
    ...(report.changedFiles.length
      ? [report.changedFiles.map((file) => `- ${file}`).join("\n")]
      : []),
  ].join("\n");
}
