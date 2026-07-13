import { z } from "zod";

export const configSchema = z.object({
  provider: z.literal("openrouter").default("openrouter"),
  model: z.string().min(1).default("anthropic/claude-sonnet-4"),
  temperature: z.number().min(0).max(2).default(0.2),
  maxSteps: z.number().int().min(1).max(200).default(40),
  maxContextTokens: z.number().int().min(1000).default(120_000),
  approvalMode: z.enum(["readonly", "workspace", "full-access"]).default("workspace"),
  stream: z.boolean().default(true),
  showCost: z.boolean().default(true),
  commandTimeoutMs: z.number().int().positive().default(120_000),
  taskTimeoutMs: z.number().int().positive().default(1_800_000),
  maxToolOutputChars: z.number().int().positive().default(50_000),
  respectGitignore: z.boolean().default(true),
  telemetry: z.literal(false).default(false),
});

export type AlexusConfig = z.infer<typeof configSchema>;
export const defaultConfig: AlexusConfig = configSchema.parse({});
