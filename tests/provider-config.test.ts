import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { credentialsPath, providerApiKey, saveProviderApiKey } from "../src/config/credentials.js";
import { filterProviderModels, slashCommandSuggestions } from "../src/cli/tui.js";

const roots: string[] = [];
const originalHome = process.env.ALEXUS_HOME;
const originalKey = process.env.OPENROUTER_API_KEY;

afterEach(async () => {
  if (originalHome === undefined) delete process.env.ALEXUS_HOME;
  else process.env.ALEXUS_HOME = originalHome;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("provider configuration", () => {
  it("stores provider credentials separately and prefers an explicit Alexus setup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "alexus-credentials-"));
    roots.push(root);
    process.env.ALEXUS_HOME = root;
    delete process.env.OPENROUTER_API_KEY;
    await saveProviderApiKey("openrouter", "stored-secret-key");
    expect(providerApiKey("openrouter")).toBe("stored-secret-key");
    expect(JSON.parse(await readFile(credentialsPath(), "utf8"))).toMatchObject({
      providers: { openrouter: { apiKey: "stored-secret-key" } },
    });
    if (process.platform !== "win32")
      expect((await stat(credentialsPath())).mode & 0o777).toBe(0o600);
    process.env.OPENROUTER_API_KEY = "environment-secret-key";
    expect(providerApiKey("openrouter")).toBe("stored-secret-key");
  });

  it("filters slash commands as the user types", () => {
    expect(slashCommandSuggestions("/").length).toBeGreaterThan(5);
    expect(slashCommandSuggestions("/co").map((item) => item.command)).toEqual([
      "/context",
      "/compact",
    ]);
    expect(slashCommandSuggestions("ordinary task")).toEqual([]);
  });

  it("searches only models compatible with Alexus tools", () => {
    const models = [
      {
        id: "anthropic/claude-test",
        name: "Claude Test",
        contextLength: 1,
        pricing: {},
        supportedParameters: ["tools"],
        tools: true,
      },
      {
        id: "example/text-only",
        name: "Text only",
        contextLength: 1,
        pricing: {},
        supportedParameters: [],
        tools: false,
      },
    ];
    expect(filterProviderModels(models, "claude").map((model) => model.id)).toEqual([
      "anthropic/claude-test",
    ]);
    expect(filterProviderModels(models, "text-only")).toEqual([]);
  });
});
