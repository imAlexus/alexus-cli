import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
  it("fails clearly when the OpenRouter key is absent", async () => {
    const before = process.env.OPENROUTER_API_KEY;
    const beforeHome = process.env.ALEXUS_HOME;
    const emptyHome = await mkdtemp(path.join(tmpdir(), "alexus-empty-home-"));
    process.env.ALEXUS_HOME = emptyHome;
    delete process.env.OPENROUTER_API_KEY;
    expect(() => createOpenRouterClient()).toThrow(/alexus provider|OPENROUTER_API_KEY/);
    if (before) process.env.OPENROUTER_API_KEY = before;
    else delete process.env.OPENROUTER_API_KEY;
    if (beforeHome) process.env.ALEXUS_HOME = beforeHome;
    else delete process.env.ALEXUS_HOME;
    await rm(emptyHome, { recursive: true, force: true });
  });
});
