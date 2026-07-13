import { ToolRegistry } from "./registry.js";
import {
  listFilesTool,
  readFileTool,
  searchFilesTool,
  writeFileTool,
  applyPatchTool,
} from "./filesystem.js";
import { runCommandTool } from "./shell.js";
import { gitStatusTool, gitDiffTool } from "./git.js";
import { updatePlanTool } from "./planning.js";
export function createDefaultRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(listFilesTool)
    .register(readFileTool)
    .register(searchFilesTool)
    .register(writeFileTool)
    .register(applyPatchTool)
    .register(runCommandTool)
    .register(gitStatusTool)
    .register(gitDiffTool)
    .register(updatePlanTool);
}
