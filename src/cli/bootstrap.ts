import { Command } from "commander";
import { updateAlexus } from "./update-command.js";
import { errorMessage } from "../utils/errors.js";
import { PACKAGE_VERSION } from "../utils/version.js";

const argumentsList = process.argv.slice(2);
const updateOnly =
  argumentsList[0] === "update" ||
  (argumentsList[0] === "--debug" && argumentsList[1] === "update");

if (updateOnly) {
  const program = new Command();
  program.name("alexus").version(PACKAGE_VERSION).option("--debug", "mostra stack trace");
  program
    .command("update")
    .description("aggiorna Alexus CLI all'ultima release verificata")
    .option("--check", "controlla senza installare")
    .option("--force", "reinstalla anche la stessa versione")
    .option("--version <version>", "installa una versione specifica")
    .action((options: { check?: boolean; force?: boolean; version?: string }) =>
      updateAlexus(options),
    );
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    process.stderr.write(`${errorMessage(error, program.opts<{ debug?: boolean }>().debug)}\n`);
    process.exitCode = 1;
  }
} else {
  await import("./index.js");
}
