import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionStore } from "../src/sessions/sqlite-store.js";
import { EventBus } from "../src/protocol/event-bus.js";
import {
  applyPatchTool,
  applyEditsTool,
  listFilesTool,
  readFileTool,
  searchFilesTool,
} from "../src/tools/filesystem.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "alexus-tool-"));
  roots.push(root);
  const store = new SessionStore(root);
  const session = store.create({ model: "test/model", task: "test", approvalMode: "workspace" });
  const context = {
    workspaceRoot: root,
    sessionId: session.id,
    store,
    events: new EventBus(),
    signal: new AbortController().signal,
    maxOutputChars: 1000,
  };
  return { root, store, session, context };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("filesystem tools", () => {
  it("reads numbered text and rejects binary files", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "a.txt"), "one\ntwo\n");
    expect(
      await readFileTool.execute({ path: "a.txt", startLine: 1, endLine: 2 }, f.context),
    ).toMatchObject({ content: "1: one\n2: two" });
    await writeFile(path.join(f.root, "binary.bin"), Buffer.from([1, 0, 2]));
    await expect(
      readFileTool.execute({ path: "binary.bin", startLine: 1, endLine: 2 }, f.context),
    ).rejects.toThrow(/binario/);
    f.store.close();
  });
  it("respects .gitignore for list and search", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, ".gitignore"), "ignored.txt\n");
    await writeFile(path.join(f.root, "ignored.txt"), "needle");
    await writeFile(path.join(f.root, "kept.txt"), "needle");
    const listed = (await listFilesTool.execute({ path: ".", depth: 2 }, f.context)) as {
      entries: string[];
    };
    expect(listed.entries).toContain("kept.txt");
    expect(listed.entries).not.toContain("ignored.txt");
    const searched = (await searchFilesTool.execute(
      { query: "needle", glob: "**/*.txt", maxResults: 10 },
      f.context,
    )) as { matches: Array<{ path: string }> };
    expect(searched.matches.map((x) => x.path)).toEqual(["kept.txt"]);
    f.store.close();
  });
  it("applies exact patches, detects conflicts and performs safe undo", async () => {
    const f = await fixture();
    const file = path.join(f.root, "code.ts");
    await writeFile(file, "export const value = 1;\n");
    await applyPatchTool.execute(
      { path: "code.ts", oldText: "value = 1", newText: "value = 2" },
      f.context,
    );
    expect(await readFile(file, "utf8")).toContain("value = 2");
    expect(await f.store.diff(f.session.id)).toContain("value = 2");
    await expect(
      applyPatchTool.execute({ path: "code.ts", oldText: "missing", newText: "x" }, f.context),
    ).rejects.toThrow(/non è presente/);
    expect(await f.store.undo(f.session.id)).toEqual(["code.ts"]);
    expect(await readFile(file, "utf8")).toContain("value = 1");
    f.store.close();
  });
  it("does not overwrite user edits made after Alexus", async () => {
    const f = await fixture();
    const file = path.join(f.root, "code.ts");
    await writeFile(file, "old");
    await applyPatchTool.execute({ path: "code.ts", oldText: "old", newText: "agent" }, f.context);
    await writeFile(file, "user");
    await expect(f.store.undo(f.session.id)).rejects.toThrow(/modificato dopo Alexus/);
    f.store.close();
  });
  it("applies related edits to multiple files as one transaction", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(f.root, "b.ts"), "export const b = 1;\n");
    const result = (await applyEditsTool.execute(
      {
        edits: [
          { path: "a.ts", oldText: "a = 1", newText: "a = 2" },
          { path: "b.ts", oldText: "b = 1", newText: "b = 2" },
        ],
      },
      f.context,
    )) as { paths: string[] };
    expect(result.paths).toEqual(["a.ts", "b.ts"]);
    expect(await readFile(path.join(f.root, "a.ts"), "utf8")).toContain("a = 2");
    expect(await readFile(path.join(f.root, "b.ts"), "utf8")).toContain("b = 2");
    expect(f.store.changedFiles(f.session.id)).toEqual(["a.ts", "b.ts"]);
    f.store.close();
  });
  it("writes nothing when one edit in a transaction conflicts", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "a.ts"), "a = 1\n");
    await writeFile(path.join(f.root, "b.ts"), "b = 1\n");
    await expect(
      applyEditsTool.execute(
        {
          edits: [
            { path: "a.ts", oldText: "a = 1", newText: "a = 2" },
            { path: "b.ts", oldText: "missing", newText: "b = 2" },
          ],
        },
        f.context,
      ),
    ).rejects.toThrow(/non è presente/);
    expect(await readFile(path.join(f.root, "a.ts"), "utf8")).toBe("a = 1\n");
    expect(await readFile(path.join(f.root, "b.ts"), "utf8")).toBe("b = 1\n");
    expect(f.store.changedFiles(f.session.id)).toEqual([]);
    f.store.close();
  });
});
