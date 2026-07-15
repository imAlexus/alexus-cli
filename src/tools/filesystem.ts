import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import createIgnore from "ignore";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { assertSafeWritePath, resolveSafeExistingPath } from "../security/path-policy.js";
import { isSensitivePath } from "../security/secret-detector.js";
import { AlexusError } from "../utils/errors.js";
import type { ToolDefinition } from "./tool.js";

const textContent = async (file: string): Promise<string> => {
  const data = await readFile(file);
  if (data.subarray(0, 8000).includes(0))
    throw new AlexusError("TOOL_VALIDATION_FAILED", "Binary file cannot be read");
  return data.toString("utf8");
};
const baseIgnore = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.alexus/**",
  "**/.env",
  "**/*.pem",
  "**/*.key",
];
async function respectGitignore(root: string, files: string[]): Promise<string[]> {
  try {
    const rules = await readFile(path.join(root, ".gitignore"), "utf8");
    const matcher = createIgnore().add(rules);
    return files.filter((file) => !matcher.ignores(file.replaceAll("\\", "/")));
  } catch {
    return files;
  }
}

const listSchema = z
  .object({ path: z.string().default("."), depth: z.number().int().min(1).max(10).default(3) })
  .strict();
export const listFilesTool: ToolDefinition<typeof listSchema> = {
  name: "list_files",
  description: "List text files and directories in the workspace while respecting .gitignore.",
  schema: listSchema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { path: { type: "string" }, depth: { type: "integer", minimum: 1, maximum: 10 } },
    required: ["path", "depth"],
  },
  async execute(input, c) {
    const root = await resolveSafeExistingPath(c.workspaceRoot, input.path);
    if (!(await stat(root)).isDirectory())
      throw new AlexusError("TOOL_VALIDATION_FAILED", "The path is not a directory");
    let entries = await fg("**/*", {
      cwd: root,
      dot: true,
      onlyFiles: false,
      deep: input.depth,
      ignore: baseIgnore,
      followSymbolicLinks: false,
      suppressErrors: true,
    });
    const logicalRoot = path.resolve(c.workspaceRoot, input.path);
    const prefix = path.relative(c.workspaceRoot, logicalRoot).replaceAll("\\", "/");
    const workspaceEntries = entries.map((entry) => (prefix ? `${prefix}/${entry}` : entry));
    const allowed = new Set(await respectGitignore(c.workspaceRoot, workspaceEntries));
    entries = entries.filter((_, index) => allowed.has(workspaceEntries[index]!));
    return { path: input.path, entries: entries.slice(0, 1000), truncated: entries.length > 1000 };
  },
};

const readSchema = z
  .object({
    path: z.string(),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.endLine >= v.startLine && v.endLine - v.startLine < 1000, "Invalid line range");
export const readFileTool: ToolDefinition<typeof readSchema> = {
  name: "read_file",
  description: "Read up to 1000 numbered lines from a text file inside the workspace.",
  schema: readSchema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string" },
      startLine: { type: "integer", minimum: 1 },
      endLine: { type: "integer", minimum: 1 },
    },
    required: ["path", "startLine", "endLine"],
  },
  async execute(input, c) {
    if (isSensitivePath(input.path))
      throw new AlexusError(
        "APPROVAL_DENIED",
        `Automatic reading of a sensitive file is blocked: ${input.path}`,
      );
    const content = await textContent(await resolveSafeExistingPath(c.workspaceRoot, input.path));
    const lines = content.split(/\r?\n/);
    return {
      path: input.path,
      totalLines: lines.length,
      content: lines
        .slice(input.startLine - 1, input.endLine)
        .map((line, i) => `${input.startLine + i}: ${line}`)
        .join("\n"),
    };
  },
};

const searchSchema = z
  .object({
    query: z.string().min(1),
    glob: z.string().default("**/*"),
    maxResults: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export const searchFilesTool: ToolDefinition<typeof searchSchema> = {
  name: "search_files",
  description: "Search for literal text in workspace files.",
  schema: searchSchema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string" },
      glob: { type: "string" },
      maxResults: { type: "integer", minimum: 1, maximum: 200 },
    },
    required: ["query", "glob", "maxResults"],
  },
  async execute(input, c) {
    const files = await respectGitignore(
      c.workspaceRoot,
      await fg(input.glob, {
        cwd: c.workspaceRoot,
        onlyFiles: true,
        dot: true,
        ignore: baseIgnore,
        followSymbolicLinks: false,
        suppressErrors: true,
      }),
    );
    const matches: Array<{ path: string; line: number; text: string }> = [];
    for (const relative of files.slice(0, 5000)) {
      if (isSensitivePath(relative)) continue;
      let content: string;
      try {
        content = await textContent(await resolveSafeExistingPath(c.workspaceRoot, relative));
      } catch {
        continue;
      }
      for (const [i, line] of content.split(/\r?\n/).entries()) {
        if (line.includes(input.query)) {
          matches.push({ path: relative, line: i + 1, text: line.slice(0, 500) });
          if (matches.length >= input.maxResults) return { matches, truncated: true };
        }
      }
    }
    return { matches, truncated: false };
  },
};

const writeSchema = z.object({ path: z.string(), content: z.string() }).strict();
export const writeFileTool: ToolDefinition<typeof writeSchema> = {
  name: "write_file",
  description: "Create a new text file. Reject paths that already exist.",
  schema: writeSchema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(input, c) {
    const file = await assertSafeWritePath(c.workspaceRoot, input.path);
    try {
      await stat(file);
      throw new AlexusError(
        "PATCH_CONFLICT",
        `File already exists: ${input.path}; use apply_patch`,
      );
    } catch (e) {
      if (e instanceof AlexusError) throw e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await c.store.checkpoint(c.sessionId, input.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, input.content, { flag: "wx" });
    await c.store.markWritten(c.sessionId, input.path);
    return { path: input.path, created: true, bytes: Buffer.byteLength(input.content) };
  },
};

const patchSchema = z
  .object({ path: z.string(), oldText: z.string().min(1), newText: z.string() })
  .strict();
export const applyPatchTool: ToolDefinition<typeof patchSchema> = {
  name: "apply_patch",
  description: "Replace one exact and unique section of a file. oldText must match byte for byte.",
  schema: patchSchema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string" },
      oldText: { type: "string" },
      newText: { type: "string" },
    },
    required: ["path", "oldText", "newText"],
  },
  async execute(input, c) {
    const file = await resolveSafeExistingPath(c.workspaceRoot, input.path);
    const before = await textContent(file);
    const first = before.indexOf(input.oldText);
    if (first < 0)
      throw new AlexusError("PATCH_CONFLICT", `The original text was not found in ${input.path}`);
    if (before.indexOf(input.oldText, first + 1) >= 0)
      throw new AlexusError("PATCH_CONFLICT", `The original text is not unique in ${input.path}`);
    await c.store.checkpoint(c.sessionId, input.path);
    const after =
      before.slice(0, first) + input.newText + before.slice(first + input.oldText.length);
    await writeFile(file, after);
    await c.store.markWritten(c.sessionId, input.path);
    return {
      path: input.path,
      diff: createTwoFilesPatch(input.path, input.path, before, after, "before", "after"),
    };
  },
};

const multiEditSchema = z
  .object({
    edits: z
      .array(
        z.object({ path: z.string(), oldText: z.string().min(1), newText: z.string() }).strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const applyEditsTool: ToolDefinition<typeof multiEditSchema> = {
  name: "apply_edits",
  description:
    "Apply up to 50 exact replacements across multiple files as one transaction: if any edit conflicts, write no files.",
  schema: multiEditSchema,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      edits: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            oldText: { type: "string" },
            newText: { type: "string" },
          },
          required: ["path", "oldText", "newText"],
        },
      },
    },
    required: ["edits"],
  },
  async execute(input, c) {
    const files = new Map<string, string>();
    const resolved = new Map<string, string>();

    // Prepare the entire transaction in memory before touching the filesystem.
    for (const edit of input.edits) {
      if (isSensitivePath(edit.path))
        throw new AlexusError(
          "APPROVAL_DENIED",
          `Automatic editing of a sensitive file is blocked: ${edit.path}`,
        );
      let content = files.get(edit.path);
      if (content === undefined) {
        const file = await resolveSafeExistingPath(c.workspaceRoot, edit.path);
        resolved.set(edit.path, file);
        content = await textContent(file);
      }
      const first = content.indexOf(edit.oldText);
      if (first < 0)
        throw new AlexusError("PATCH_CONFLICT", `The original text was not found in ${edit.path}`);
      if (content.indexOf(edit.oldText, first + 1) >= 0)
        throw new AlexusError("PATCH_CONFLICT", `The original text is not unique in ${edit.path}`);
      files.set(
        edit.path,
        content.slice(0, first) + edit.newText + content.slice(first + edit.oldText.length),
      );
    }

    const before = new Map<string, string>();
    for (const [relative, file] of resolved) {
      before.set(relative, await textContent(file));
      await c.store.checkpoint(c.sessionId, relative);
    }

    const written: string[] = [];
    try {
      for (const [relative, content] of files) {
        await writeFile(resolved.get(relative)!, content);
        written.push(relative);
      }
    } catch (error) {
      await Promise.all(
        written.map((relative) => writeFile(resolved.get(relative)!, before.get(relative)!)),
      );
      throw error;
    }
    for (const relative of files.keys()) await c.store.markWritten(c.sessionId, relative);

    return {
      paths: [...files.keys()],
      edits: input.edits.length,
      diffs: [...files].map(([relative, content]) => ({
        path: relative,
        diff: createTwoFilesPatch(
          relative,
          relative,
          before.get(relative)!,
          content,
          "before",
          "after",
        ),
      })),
    };
  },
};
