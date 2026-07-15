import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compareVersions, verifyPackageChecksum } from "../src/cli/update-command.js";

describe("self update", () => {
  it("compares stable semantic versions", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("v1.1.0", "1.1")).toBe(0);
    expect(compareVersions("1.0.9", "1.1.0")).toBe(-1);
    expect(() => compareVersions("latest", "1.0.0")).toThrow(/Invalid version/);
  });

  it("accepts only the matching SHA-256 checksum", () => {
    const data = Buffer.from("verified package");
    const checksum = createHash("sha256").update(data).digest("hex");
    expect(verifyPackageChecksum(data, `${checksum}  alexus.tgz\n`)).toBe(true);
    expect(verifyPackageChecksum(data, `${"0".repeat(64)}  alexus.tgz\n`)).toBe(false);
  });
});
