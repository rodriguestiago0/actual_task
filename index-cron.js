import cron from "node-cron";
import { loadConfig, loadEnvFile } from "./src/config.js";
import { runEnabledTasks, tasks } from "./src/engine.js";

loadEnvFile();
const config = loadConfig();

console.info("Cron expression:", config.cronExpression);
for (const [name, task] of Object.entries(tasks)) {
  if (task.enabled(config)) console.info(`Task ${name} enabled`);
}

const task = cron.schedule(
  config.cronExpression,
  async () => {
    await runEnabledTasks(config);
    console.info("Next run:", task.getNextRun()?.toISOString());
  },
  { noOverlap: true },
);
console.info("Next run:", task.getNextRun()?.toISOString());

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    console.info(`Received ${signal}, stopping`);
    await task.stop();
    process.exit(0);
  });
}
