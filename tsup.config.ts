import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli/index.ts", index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["better-sqlite3"],
});
