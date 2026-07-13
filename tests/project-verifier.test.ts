import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectProject } from "../src/project/project-detector.js";
import { runAutomaticVerification, selectVerificationCommands } from "../src/agent/verifier.js";
import { SessionStore } from "../src/sessions/sqlite-store.js";
import { EventBus } from "../src/protocol/event-bus.js";
import { defaultConfig } from "../src/config/schema.js";
import type { AlexusEvent } from "../src/protocol/events.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), "alexus-project-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  for (const value of roots.splice(0)) await rm(value, { recursive: true, force: true });
});

describe("project detection", () => {
  it("detects the package manager, framework and ordered checks", async () => {
    const workspace = await root();
    await writeFile(path.join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        devDependencies: { react: "19.0.0" },
        scripts: { build: "tsup", test: "vitest", lint: "eslint .", typecheck: "tsc" },
      }),
    );

    const profile = await detectProject(workspace);
    expect(profile).toMatchObject({
      ecosystems: ["Node.js"],
      frameworks: ["React"],
      packageManager: "pnpm",
    });
    expect(profile.verificationCommands.map((command) => command.kind)).toEqual([
      "lint",
      "typecheck",
      "test",
      "build",
    ]);
    expect(selectVerificationCommands(profile.verificationCommands, ["README.md"])).toEqual([]);
    expect(
      selectVerificationCommands(profile.verificationCommands, ["tests/unit.test.ts"]).map(
        (command) => command.kind,
      ),
    ).not.toContain("build");
  });

  it("ignores the default npm placeholder test", async () => {
    const workspace = await root();
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    expect((await detectProject(workspace)).verificationCommands).toEqual([]);
  });
});

describe("automatic verifier", () => {
  it("runs detected checks and streams their output as events", async () => {
    const workspace = await root();
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "node -e \"console.log('verified-output')\"" } }),
    );
    const store = new SessionStore(workspace);
    const session = store.create({ model: "test/model", task: "test", approvalMode: "workspace" });
    const turn = store.createTurn(session.id, "test");
    const events = new EventBus();
    const received: AlexusEvent[] = [];
    events.on((value) => received.push(value));

    try {
      const summary = await runAutomaticVerification({
        workspaceRoot: workspace,
        sessionId: session.id,
        turnId: turn.id,
        store,
        events,
        signal: new AbortController().signal,
        config: { ...defaultConfig, commandTimeoutMs: 30_000 },
      });

      expect(summary).toMatchObject({
        status: "verified",
        results: [{ success: true, exitCode: 0 }],
      });
      expect(received.some((value) => value.type === "verification.plan")).toBe(true);
      expect(
        received.some(
          (value) =>
            value.type === "command.output" && String(value.text).includes("verified-output"),
        ),
      ).toBe(true);
    } finally {
      store.close();
    }
  });
});
