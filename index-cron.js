import cron from "node-cron";
import { loadConfig, loadEnvFile } from "./src/config.js";
import {
  enabledTaskNames,
  idle,
  runTasks,
  scheduleGroups,
  unknownCronVariables,
} from "./src/engine.js";
import { log, silenceLibraryLogs } from "./src/log.js";

loadEnvFile();
silenceLibraryLogs();
const config = loadConfig();
const enabled = enabledTaskNames(config);

for (const variable of unknownCronVariables(config)) {
  log.warn(`Ignoring ${variable}: no task with that name`);
}

// Installed before anything is scheduled, so a stop during startup still exits cleanly.
const scheduled = [];
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    log.info(`Received ${signal}, stopping`);
    await Promise.all(scheduled.map((task) => task.stop()));
    // Let a running task finish so its changes are synced before exiting.
    await idle();
    process.exit(0);
  });
}

for (const [expression, names] of scheduleGroups(config, enabled)) {
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
  scheduled.push(task);
}

if (enabled.length === 0) log.warn("No tasks enabled");
if (config.notifications.length > 0) {
  log.info(`Notifications: ${config.notifications.map((channel) => channel.name).join(", ")}`);
}

if (config.runOnStart) await runTasks(config, enabled);
