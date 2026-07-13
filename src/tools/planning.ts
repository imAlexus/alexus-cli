import { z } from "zod";
import { event } from "../protocol/events.js";
import type { ToolDefinition } from "./tool.js";

const stepSchema = z
  .object({
    step: z.string().min(1).max(500),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict();

const schema = z
  .object({
    explanation: z.string().max(2_000).optional(),
    plan: z.array(stepSchema).min(1).max(20),
  })
  .strict()
  .refine(
    (value) => value.plan.filter((step) => step.status === "in_progress").length <= 1,
    "Il piano può contenere al massimo uno step in corso",
  );

export const updatePlanTool: ToolDefinition<typeof schema> = {
  name: "update_plan",
  description:
    "Crea o aggiorna il piano strutturato della sessione. Usalo per task con più passaggi e mantieni un solo step in corso.",
  schema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      explanation: { type: "string", maxLength: 2000 },
      plan: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            step: { type: "string", minLength: 1, maxLength: 500 },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["step", "status"],
        },
      },
    },
    required: ["plan"],
  },
  execute(input, context) {
    const stored = context.store.savePlan(context.sessionId, input.plan, input.explanation);
    context.events.emit(
      event(context.sessionId, "plan.updated", {
        explanation: stored.explanation,
        plan: stored.steps,
        updatedAt: stored.updatedAt,
      }),
    );
    return Promise.resolve({
      updated: true,
      completed: stored.steps.filter((step) => step.status === "completed").length,
      total: stored.steps.length,
    });
  },
};
