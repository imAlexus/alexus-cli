import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { jsonlWriter } from "../src/protocol/jsonl-writer.js";
import { event } from "../src/protocol/events.js";
import { createOpenRouterClient } from "../src/providers/openrouter/client.js";

describe("protocol and provider config", () => {
  it("writes one valid JSON object per event", () => {
    const stream = new PassThrough();
    let output = "";
    stream.on("data", (chunk) => (output += String(chunk)));
    const write = jsonlWriter(stream);
    write(event("ses_test", "session.started", { workspace: "x" }));
    write(event("ses_test", "session.completed", { success: true }));
    const lines = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sessionId: string; version: number });
    expect(lines).toHaveLength(2);
    expect(lines.every((x) => x.sessionId === "ses_test" && x.version === 1)).toBe(true);
  });
  it("fails clearly when the OpenRouter key is absent", () => {
    const before = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(() => createOpenRouterClient()).toThrow(/OPENROUTER_API_KEY/);
    if (before) process.env.OPENROUTER_API_KEY = before;
  });
});
