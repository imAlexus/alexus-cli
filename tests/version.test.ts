import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../src/utils/version.js";

describe("package version", () => {
  it("keeps the CLI version synchronized with package.json", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
    };
    expect(PACKAGE_VERSION).toBe(manifest.version);
  });
});
