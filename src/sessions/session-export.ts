import { redactSecrets } from "../security/secret-detector.js";
import { buildSessionReport } from "./session-report.js";
import type { SessionStore } from "./sqlite-store.js";

const sensitiveKey =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie)$/i;

export function sanitizeSessionValue(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeSessionValue(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitizeSessionValue(child, childKey),
      ]),
    );
  return value;
}

export async function buildSessionExport(store: SessionStore, sessionId: string): Promise<unknown> {
  const session = store.get(sessionId);
  if (!session) throw new Error("Sessione non trovata");
  const turns = store.turns(sessionId).map((turn) => ({
    ...turn,
    items: store.items(turn.id),
  }));
  const report = await buildSessionReport(store, sessionId);
  return sanitizeSessionValue({
    format: "alexus-session",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    session: { ...session, workspaceRoot: "." },
    turns,
    plan: store.plan(sessionId) ?? null,
    report: { ...report, session: { ...report.session, workspaceRoot: "." } },
  });
}
