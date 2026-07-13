import { Command } from "commander";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  initializeWorkspace,
  isWritable,
  loadConfig,
  projectConfigPath,
  saveProjectConfig,
} from "../config/loader.js";
import { configSchema } from "../config/schema.js";
import { errorMessage } from "../utils/errors.js";
import { PACKAGE_VERSION } from "../utils/version.js";
import { executeTask } from "./run-task.js";
import { startRepl } from "./repl.js";
import { SessionStore } from "../sessions/sqlite-store.js";
import { listModels } from "../providers/openrouter/models.js";

const program = new Command();
program
  .name("alexus")
  .description("Agente CLI sicuro per lo sviluppo software")
  .version(PACKAGE_VERSION)
  .option("--debug", "mostra stack trace");
const root = () => process.cwd();
program
  .command("init")
  .description("inizializza Alexus nel workspace")
  .action(async () => {
    await initializeWorkspace(root());
    console.log(`Inizializzato ${path.join(root(), ".alexus")}`);
  });
program
  .command("run")
  .description("esegue un task singolo")
  .argument("<task>")
  .option("--model <id>")
  .option("--json", "emette solo JSONL su stdout")
  .option("--max-cost <usd>", "limite costo", Number)
  .option("--approval-mode <mode>")
  .action(
    async (
      task: string,
      o: {
        model?: string;
        json?: boolean;
        maxCost?: number;
        approvalMode?: "readonly" | "workspace" | "full-access";
      },
    ) => executeTask(root(), task, o),
  );
program
  .command("chat")
  .description("avvia la modalità interattiva")
  .action(() => startRepl(root()));
program
  .command("resume")
  .description("riprende l'ultima sessione o una sessione specifica")
  .argument("[id]")
  .action(async (id?: string) => {
    const store = new SessionStore(root());
    const session = id ? store.get(id) : store.latest();
    if (!session) {
      store.close();
      throw new Error("Sessione non trovata");
    }
    store.close();
    await executeTask(root(), `Continua il task originale: ${session.task}`, {
      resumeSessionId: session.id,
    });
  });
const sessions = program.command("sessions").description("elenca o elimina sessioni");
sessions.action(() => {
  const store = new SessionStore(root());
  try {
    for (const s of store.list()) console.log(`${s.id}\t${s.status}\t${s.updatedAt}\t${s.task}`);
  } finally {
    store.close();
  }
});
sessions
  .command("delete")
  .argument("<id>")
  .action((id: string) => {
    const store = new SessionStore(root());
    try {
      if (!store.delete(id)) throw new Error("Sessione non trovata");
      console.log(`Eliminata ${id}`);
    } finally {
      store.close();
    }
  });
sessions
  .command("show")
  .argument("<id>")
  .option("--json")
  .action((id: string, options: { json?: boolean }) => {
    const store = new SessionStore(root());
    try {
      const session = store.get(id);
      if (!session) throw new Error("Sessione non trovata");
      const turns = store.turns(id).map((turn) => ({ ...turn, items: store.items(turn.id) }));
      if (options.json) {
        console.log(JSON.stringify({ session, turns }, null, 2));
        return;
      }
      console.log(`${session.id}  ${session.status}  ${session.task}`);
      for (const turn of turns) {
        console.log(`  ${turn.id}  ${turn.status}  ${turn.prompt}`);
        for (const item of turn.items) console.log(`    ${item.id}  ${item.type}  ${item.status}`);
      }
    } finally {
      store.close();
    }
  });
program
  .command("status")
  .description("mostra configurazione e stato Git")
  .action(async () => {
    const config = await loadConfig(root());
    console.log(`Workspace: ${root()}\nModel: ${config.model}\nMode: ${config.approvalMode}`);
    const r = await runProcess("git", ["status", "--short", "--branch"], root());
    console.log(r.stdout || r.stderr);
  });
program
  .command("diff")
  .description("mostra le modifiche della sessione Alexus")
  .argument("[id]")
  .action(async (id?: string) => {
    const store = new SessionStore(root());
    try {
      const session = id ? store.get(id) : store.latest();
      if (!session) throw new Error("Sessione non trovata");
      process.stdout.write((await store.diff(session.id)) || "Nessuna modifica nella sessione.\n");
    } finally {
      store.close();
    }
  });
program
  .command("undo")
  .description("annulla solo le modifiche della sessione")
  .argument("[id]")
  .action(async (id?: string) => {
    const store = new SessionStore(root());
    try {
      const session = id ? store.get(id) : store.latest();
      if (!session) throw new Error("Sessione non trovata");
      const files = await store.undo(session.id);
      console.log(`Ripristinati: ${files.join(", ") || "nessun file"}`);
    } finally {
      store.close();
    }
  });
program
  .command("config")
  .description("mostra la configurazione risolta")
  .action(async () => console.log(JSON.stringify(await loadConfig(root()), null, 2)));
const model = program.command("model").description("gestisce il modello OpenRouter");
model.command("get").action(async () => console.log((await loadConfig(root())).model));
model
  .command("set")
  .argument("<id>")
  .action(async (id: string) => {
    const config = await loadConfig(root());
    await saveProjectConfig(root(), { ...config, model: id });
    console.log(`Modello: ${id}`);
  });
model
  .command("list")
  .option("--tools")
  .option("--refresh")
  .action(async (o: { tools?: boolean; refresh?: boolean }) => {
    await initializeWorkspace(root());
    for (const m of await listModels(root(), o.refresh))
      if (!o.tools || m.tools)
        console.log(`${m.id}\t${m.contextLength}\t${m.tools ? "tools" : "-"}\t${m.name}`);
  });
model
  .command("search")
  .argument("<query>")
  .action(async (q: string) => {
    for (const m of await listModels(root()))
      if (`${m.id} ${m.name}`.toLowerCase().includes(q.toLowerCase()))
        console.log(`${m.id}\t${m.tools ? "tools" : "-"}\t${m.name}`);
  });
program
  .command("doctor")
  .description("verifica ambiente, config e database")
  .action(async () => {
    await initializeWorkspace(root());
    const checks: Array<[string, boolean, string]> = [];
    checks.push([
      "Node >=22",
      Number(process.versions.node.split(".")[0]) >= 22,
      process.versions.node,
    ]);
    const git = await runProcess("git", ["--version"], root());
    checks.push(["Git", git.code === 0, (git.stdout || git.stderr).trim()]);
    checks.push([
      "OPENROUTER_API_KEY",
      Boolean(process.env.OPENROUTER_API_KEY),
      process.env.OPENROUTER_API_KEY ? "presente" : "mancante",
    ]);
    checks.push(["Workspace scrivibile", await isWritable(root()), root()]);
    const parsed = configSchema.safeParse(await loadConfig(root()));
    checks.push(["Configurazione", parsed.success, projectConfigPath(root())]);
    const store = new SessionStore(root());
    checks.push(["Database", store.integrity() === "ok", store.integrity()]);
    store.close();
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const models = await listModels(root(), true);
        const selected = (await loadConfig(root())).model;
        const found = models.find((m) => m.id === selected);
        checks.push(["Modello disponibile", Boolean(found), selected]);
        checks.push([
          "Tool calling",
          Boolean(found?.tools),
          found?.tools ? "supportato" : "non supportato",
        ]);
      } catch (e) {
        checks.push(["OpenRouter", false, errorMessage(e)]);
      }
    }
    for (const [name, ok, detail] of checks) console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
    if (checks.some((x) => !x[1])) process.exitCode = 1;
  });
program.action(() => startRepl(root()));
async function runProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (x) => (stdout += String(x)));
    child.stderr.on("data", (x) => (stderr += String(x)));
    child.on("error", (e) => resolve({ code: 1, stdout, stderr: e.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
program.parseAsync().catch((error) => {
  const debug = program.opts<{ debug?: boolean }>().debug;
  process.stderr.write(`${errorMessage(error, debug)}\n`);
  process.exitCode = 1;
});
