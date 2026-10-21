import { withBudget } from "./actual.js";
import { calculateMortgage } from "./tasks/mortgage.js";
import { fixPayees } from "./tasks/payees.js";
import {
  fetchGhostfolioBalances,
  fetchWealthfolioBalances,
  syncBalances,
} from "./tasks/portfolio.js";

/** Tasks in the order the scheduler runs them. Each is enabled when its config is set. */
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

export async function runEnabledTasks(config) {
  let ok = true;
  for (const [name, task] of Object.entries(tasks)) {
    if (!task.enabled(config)) continue;
    console.info(`Running ${name}`);
    try {
      await task.run(config);
    } catch (err) {
      ok = false;
      console.error(`${name} failed:`, err);
    }
  }
  return ok;
}
