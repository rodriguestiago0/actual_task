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

/** Tasks in the order they run when scheduled together. Each is enabled when its config is set. */
export const tasks = {
  "calculate-mortgage": {
    enabled: (config) => config.mortgage,
    run: (config) => withBudget(config.actual, (api) => calculateMortgage(api, config.mortgage)),
  },
  "fix-payees": {
    enabled: (config) => config.payeeRename,
    run: (config) => withBudget(config.actual, (api) => fixPayees(api, config.payeeRename)),
  },
  "ghostfolio-sync": {
    enabled: (config) => config.ghostfolio,
    run: async (config) => {
      const balances = await fetchGhostfolioBalances(config.ghostfolio);
      await withBudget(config.actual, (api) =>
        syncBalances(api, "Ghostfolio", config.ghostfolio.accounts, balances),
      );
    },
  },
  "wealthfolio-sync": {
    enabled: (config) => config.wealthfolio,
    run: async (config) => {
      const balances = await fetchWealthfolioBalances(config.wealthfolio);
      await withBudget(config.actual, (api) =>
        syncBalances(api, "Wealthfolio", config.wealthfolio.accounts, balances),
      );
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

// The Actual API holds a single open budget, so tasks must never run concurrently,
// even when they are on different schedules.
let queue = Promise.resolve();
function runExclusive(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/** Runs the given tasks one after another; failures are logged and notified. */
export function runTasks(config, names, registry = tasks) {
  return runExclusive(async () => {
    let ok = true;
    for (const name of names) {
      log.info(`Running ${name}`);
      try {
        await registry[name].run(config);
        log.info(`Finished ${name}`);
      } catch (err) {
        ok = false;
        log.error(`${name} failed:`, err);
        await notify(config.notifications, `❌ actual-tasks: ${name} failed\n${err.message}`);
      }
    }
    return ok;
  });
}
