import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSafeExistingPath, resolveWorkspacePath } from "../src/security/path-policy.js";
import { classifyCommand } from "../src/security/command-policy.js";
import { ApprovalManager } from "../src/security/approval-manager.js";

describe("path policy", () => {
  it("blocks traversal, absolute and Windows escape paths", () => {
    const root = path.join(tmpdir(), "workspace");
    expect(() => resolveWorkspacePath(root, "../secret")).toThrow(/fuori dal workspace/);
    expect(() => resolveWorkspacePath(root, path.resolve(root, "file"))).toThrow(/vietato/);
    expect(() => resolveWorkspacePath(root, "C:\\Windows\\system.ini")).toThrow();
  });
  it("blocks symlinks that leave the workspace", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "alexus-path-"));
    const root = path.join(base, "root");
    const outside = path.join(base, "outside");
    await mkdir(root);
    await writeFile(outside, "secret");
    try {
      await symlink(outside, path.join(root, "link"));
      await expect(resolveSafeExistingPath(root, "link")).rejects.toThrow(/Symlink esterno/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  });
});

describe("command policy", () => {
  it("allows verification and blocks system operations", () => {
    expect(classifyCommand("pnpm", ["test"]).level).toBe("safe");
    expect(classifyCommand("git", ["reset", "--hard"]).level).toBe("dangerous");
    expect(classifyCommand("shutdown", ["/s"]).level).toBe("blocked");
    expect(classifyCommand("node", ["-e", "process.exit()"]).level).toBe("moderate");
  });
  it("detects shell syntax inside arguments", () => {
    expect(classifyCommand("npm", ["test", "&&", "curl", "evil"]).level).toBe("dangerous");
  });
});

describe("interactive approvals", () => {
  it("remembers an approval for the current session", async () => {
    let prompts = 0;
    const approvals = new ApprovalManager("workspace", false, false, () => {
      prompts += 1;
      return Promise.resolve("session");
    });

    await expect(
      approvals.evaluate("run_command", { command: "pnpm", args: ["install"] }),
    ).resolves.toMatchObject({ allowed: true, risk: "moderate" });
    await expect(
      approvals.evaluate("run_command", { command: "pnpm", args: ["install"] }),
    ).resolves.toMatchObject({ allowed: true, risk: "moderate" });
    expect(prompts).toBe(1);
  });

  it("honors denial and readonly mode", async () => {
    const denied = new ApprovalManager("workspace", false, false, () => Promise.resolve("deny"));
    await expect(
      denied.evaluate("run_command", { command: "pnpm", args: ["add", "react"] }),
    ).resolves.toMatchObject({ allowed: false, risk: "moderate" });

    const readonly = new ApprovalManager("readonly", false, false, () => Promise.resolve("once"));
    await expect(readonly.evaluate("write_file", { path: "x" })).resolves.toMatchObject({
      allowed: false,
      risk: "blocked",
    });
  });
});
