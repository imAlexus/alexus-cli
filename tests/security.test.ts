import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSafeExistingPath, resolveWorkspacePath } from "../src/security/path-policy.js";
import { classifyCommand } from "../src/security/command-policy.js";

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
