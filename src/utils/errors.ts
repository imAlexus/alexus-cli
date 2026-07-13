export type ErrorCode =
  | "CONFIG_INVALID"
  | "API_KEY_MISSING"
  | "MODEL_NOT_FOUND"
  | "MODEL_TOOL_CALLING_UNSUPPORTED"
  | "OPENROUTER_AUTH_ERROR"
  | "OPENROUTER_RATE_LIMIT"
  | "OPENROUTER_PROVIDER_ERROR"
  | "CONTEXT_LIMIT_EXCEEDED"
  | "TOOL_VALIDATION_FAILED"
  | "PATH_OUTSIDE_WORKSPACE"
  | "COMMAND_BLOCKED"
  | "APPROVAL_DENIED"
  | "PATCH_CONFLICT"
  | "COMMAND_TIMEOUT"
  | "SESSION_NOT_FOUND"
  | "DATABASE_ERROR"
  | "USER_CANCELLED";

export class AlexusError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly recoverable = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AlexusError";
  }
}

export function errorMessage(error: unknown, debug = false): string {
  if (error instanceof AlexusError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return debug ? (error.stack ?? error.message) : error.message;
  return String(error);
}
