import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config/loader.js";
import { executeTask } from "./run-task.js";
export async function startRepl(root: string): Promise<void> {
  const config = await loadConfig(root);
  stdout.write(
    `Alexus CLI v0.1.0\n\nWorkspace: ${root}\nModel: ${config.model}\nMode: ${config.approvalMode}\n\nDigita /exit per uscire.\n`,
  );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const task = (await rl.question("\n> ")).trim();
      if (!task) continue;
      if (task === "/exit" || task === "/quit") break;
      try {
        await executeTask(root, task);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}
