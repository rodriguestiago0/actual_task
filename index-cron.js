import cron from "node-cron";
import { clearConfigError, loadConfig, loadEnvFile, reportConfigError } from "./src/config.js";
import {
  enabledTaskNames,
  runTasks,
  scheduleGroups,
  stop,
  unknownCronVariables,
} from "./src/engine.js";
import { log, silenceLibraryLogs } from "./src/log.js";

loadEnvFile();
silenceLibraryLogs();

// A configuration error exits with status 1 (after one notification), so it isn't mistaken for a
// clean stop; with a restart policy, Docker keeps retrying until the configuration is fixed.
let config, enabled, groups;
try {
  config = loadConfig();
  enabled = enabledTaskNames(config);
  if (enabled.length === 0) {
    throw new Error("No tasks enabled: set at least one ENABLE_* variable to true");
  }
  groups = scheduleGroups(config, enabled);
} catch (err) {
  await reportConfigError(err);
  process.exit(1);
}
await clearConfigError();

for (const variable of unknownCronVariables(config)) {
  log.warn(`Ignoring ${variable}: no task with that name`);
}

// Installed before anything is scheduled, so a stop during startup still exits cleanly.
const scheduled = [];
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    log.info(`Received ${signal}, stopping`);
    await Promise.all(scheduled.map((task) => task.stop()));
    // Let the running task finish so its changes are synced, skipping the rest of the batch.
    await stop();
    process.exit(0);
  });
}

for (const [expression, names] of groups) {
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

if (config.notifications.length > 0) {
  log.info(`Notifications: ${config.notifications.map((channel) => channel.name).join(", ")}`);
}

if (config.runOnStart) await runTasks(config, enabled);
