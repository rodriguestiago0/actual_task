import cron from "node-cron";
import { loadConfig, loadEnvFile } from "./src/config.js";
import { enabledTaskNames, runTasks } from "./src/engine.js";
import { log, silenceLibraryLogs } from "./src/log.js";

silenceLibraryLogs();
loadEnvFile();
const config = loadConfig();
const enabled = enabledTaskNames(config);

// Group tasks by schedule: <TASK>_CRON overrides CRON_EXPRESSION.
const groups = Map.groupBy(
  enabled,
  (name) => config.taskCronExpressions[name] ?? config.cronExpression,
);
for (const expression of groups.keys()) {
  if (!cron.validate(expression)) throw new Error(`Invalid cron expression: "${expression}"`);
}

const scheduled = [...groups].map(([expression, names]) => {
  const task = cron.schedule(
    expression,
    async () => {
      await runTasks(config, names);
      log.info(`Next run of ${names.join(", ")}:`, task.getNextRun()?.toISOString());
    },
    { noOverlap: true },
  );
  log.info(
    `Scheduled ${names.join(", ")} (${expression}), next run:`,
    task.getNextRun()?.toISOString(),
  );
  return task;
});

if (enabled.length === 0) log.warn("No tasks enabled");
if (config.notifications.length > 0) {
  log.info(`Notifications: ${config.notifications.map((channel) => channel.name).join(", ")}`);
}
if (config.runOnStart) await runTasks(config, enabled);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    log.info(`Received ${signal}, stopping`);
    await Promise.all(scheduled.map((task) => task.stop()));
    process.exit(0);
  });
}
