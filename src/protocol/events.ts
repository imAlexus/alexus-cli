export const EVENT_VERSION = 1 as const;
export interface AlexusEvent {
  type: string;
  timestamp: string;
  sessionId: string;
  version: typeof EVENT_VERSION;
  [key: string]: unknown;
}
export type EventSink = (event: AlexusEvent) => void;
export function event(
  sessionId: string,
  type: string,
  data: Record<string, unknown> = {},
): AlexusEvent {
  return { type, timestamp: new Date().toISOString(), sessionId, version: EVENT_VERSION, ...data };
}
