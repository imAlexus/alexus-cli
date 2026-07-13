import { readFileSync } from "node:fs";

function findPackageVersion(): string {
  const candidates = [
    new URL("../package.json", import.meta.url),
    new URL("../../package.json", import.meta.url),
  ];

  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof manifest.version === "string") return manifest.version;
    } catch {
      // Try the next location (bundled dist versus TypeScript source).
    }
  }

  return "0.0.0-unknown";
}

export const PACKAGE_VERSION = findPackageVersion();
