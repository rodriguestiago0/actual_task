#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadConfig, loadEnvFile } from "./src/config.js";
import { tasks } from "./src/engine.js";
import { silenceLibraryLogs } from "./src/log.js";

const USAGE = `
  Usage
    $ actual-tasks <command>

  Commands
    fix-payees           Strip PAYEE_REGEX_MATCH from payee names and merge duplicates
    calculate-mortgage   Record the principal part of the last mortgage payment
    ghostfolio-sync      Sync Ghostfolio account balances into Actual
    wealthfolio-sync     Sync Wealthfolio account balances into Actual
    bank-sync            Run Actual bank sync

  Options
    -h, --help           Show this help
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { help: { type: "boolean", short: "h" } },
});
const [command] = positionals;

if (values.help || !command) {
  console.log(USAGE);
  process.exit(command || values.help ? 0 : 1);
}
const task = tasks[command];
if (!task) {
  console.error(`Unknown command: ${command}\n${USAGE}`);
  process.exit(1);
}

silenceLibraryLogs();
try {
  loadEnvFile();
  const config = loadConfig();
  if (!task.enabled(config)) throw new Error(`${command} is not enabled`);
  await task.run(config);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
