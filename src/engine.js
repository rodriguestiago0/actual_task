import cron from "node-cron";
import { withBudget } from "./actual.js";
import { log } from "./log.js";
import { notify } from "./notify.js";
import { calculateMortgage } from "./tasks/mortgage.js";
import { fixPayees } from "./tasks/payees.js";
import {
  fetchGhostfolioBalances,
  fetchWealthfolioBalances,
  syncBalances,
} from "./tasks/portfolio.js";
import { mergeRules } from "./tasks/rules.js";

// Warnings are notified in one message, which Discord limits to 2000 characters.
const WARNING_LIMIT = 1800;

/** Joins as many items as fit in WARNING_LIMIT, counting the rest, or undefined without items. */
export function summarize(items, noun) {
  let text = "";
  let shown = 0;
  for (const item of items) {
    const next = text ? `${text}\n\n${item}` : item;
    if (shown > 0 && next.length > WARNING_LIMIT) break;
    text = next;
    shown++;
  }
  const more = items.length - shown;
  return more > 0 ? `${text}\n\n…and ${more} more ${noun}, see the logs` : text || undefined;
}

/**
 * Tasks in the order they run when scheduled together. Each is enabled when its config is set, and
 * run may resolve to a warning for the scheduler to notify about.
 */
export const tasks = {
  "calculate-mortgage": {
    enabled: (config) => config.mortgage,
    run: (config) => withBudget(config.actual, (api) => calculateMortgage(api, config.mortgage)),
  },
  "fix-payees": {
    enabled: (config) => config.payeeRename,
    run: (config) => withBudget(config.actual, (api) => fixPayees(api, config.payeeRename)),
  },
  "merge-rules": {
    enabled: (config) => config.ruleMerge,
    run: async (config) => summarize(await withBudget(config.actual, mergeRules), "conflicts"),
  },
  "ghostfolio-sync": {
    enabled: (config) => config.ghostfolio,
    run: async (config) => {
      const balances = await fetchGhostfolioBalances(config.ghostfolio);
      const warnings = await withBudget(config.actual, (api) =>
        syncBalances(api, "Ghostfolio", config.ghostfolio.accounts, balances, {
          allowZero: config.ghostfolio.allowZeroBalance,
        }),
      );
      return summarize(warnings, "accounts");
    },
  },
  "wealthfolio-sync": {
    enabled: (config) => config.wealthfolio,
    run: async (config) => {
      const balances = await fetchWealthfolioBalances(config.wealthfolio);
      const warnings = await withBudget(config.actual, (api) =>
        syncBalances(api, "Wealthfolio", config.wealthfolio.accounts, balances, {
          allowZero: config.wealthfolio.allowZeroBalance,
        }),
      );
      return summarize(warnings, "accounts");
    },
  },
  "bank-sync": {
    enabled: (config) => config.bankSync,
    run: (config) => withBudget(config.actual, (api) => api.runBankSync()),
  },
};

export function enabledTaskNames(config) {
  return Object.keys(tasks).filter((name) => tasks[name].enabled(config));
}

/** <TASK>_CRON variables that match no task, e.g. FIX_PAYEE_CRON. */
export function unknownCronVariables(config, registry = tasks) {
  return Object.keys(config.taskCronExpressions)
    .filter((name) => !Object.hasOwn(registry, name))
    .map((name) => `${name.toUpperCase().replaceAll("-", "_")}_CRON`);
}

/** Groups task names by schedule: <TASK>_CRON overrides CRON_EXPRESSION. Throws on invalid cron. */
export function scheduleGroups(config, names) {
  const groups = Map.groupBy(
    names,
    (name) => config.taskCronExpressions[name] ?? config.cronExpression,
  );
  for (const expression of groups.keys()) {
    if (!cron.validate(expression)) throw new Error(`Invalid cron expression: "${expression}"`);
  }
  return groups;
}

// The Actual API holds a single open budget, so tasks must never run concurrently,
// even when they are on different schedules.
let queue = Promise.resolve();
function runExclusive(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/** Resolves once every queued task run has finished. */
export const idle = () => queue;

// Tasks whose last run failed, so the next successful run can be reported as a recovery.
const failing = new Set();
// Each task's last warning, so the same warning is only notified once.
const warned = new Map();

/**
 * Runs the given tasks one after another; failures, recoveries and new warnings are logged and
 * notified.
 */
export function runTasks(config, names, registry = tasks) {
  return runExclusive(async () => {
    let ok = true;
    for (const name of names) {
      log.info(`Running ${name}`);
      try {
        const warning = await registry[name].run(config);
        log.info(`Finished ${name}`);
        if (failing.delete(name)) {
          await notify(config.notifications, `✅ actual-tasks: ${name} recovered`);
        }
        if (typeof warning !== "string") warned.delete(name);
        else if (warned.get(name) !== warning) {
          warned.set(name, warning);
          await notify(config.notifications, `⚠️ actual-tasks: ${name}\n${warning}`);
        }
      } catch (err) {
        ok = false;
        failing.add(name);
        log.error(`${name} failed:`, err);
        await notify(config.notifications, `❌ actual-tasks: ${name} failed\n${err.message}`);
      }
    }
    return ok;
  });
}
