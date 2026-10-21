import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import * as actualApi from "@actual-app/api";
import { log } from "./log.js";

/** Downloads a fresh copy of the budget, runs fn(api), then syncs and always shuts down. */
export async function withBudget(
  { serverURL, password, filePassword, syncId, dataDir },
  fn,
  api = actualApi,
) {
  const budgetDir = join(dataDir, syncId);
  await rm(budgetDir, { recursive: true, force: true });
  await mkdir(budgetDir, { recursive: true });

  try {
    await api.init({ serverURL, password, dataDir: budgetDir });
    await api.downloadBudget(syncId, filePassword ? { password: filePassword } : {});
  } catch (err) {
    await api.shutdown().catch(() => {});
    throw new Error(`Actual Budget error: ${err.message}`, { cause: err });
  }

  try {
    await fn(api);
    await api.sync();
  } finally {
    await api.shutdown();
  }
}

export async function importTransactions(api, accountId, transactions) {
  log.debug("Transactions to import:", transactions);
  const result = await api.importTransactions(accountId, transactions);
  log.info(
    `Imported into ${accountId}: ${result.added.length} added, ${result.updated.length} updated`,
  );
  if (result.errors?.length) log.error("Actual import errors:", result.errors);
}

/** Most recent transaction in the last month, optionally filtered by payee. */
export async function getLastTransaction(api, accountId, payeeId) {
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const transactions = await api.getTransactions(accountId, formatDate(monthAgo), formatDate());
  return transactions.find((t) => !payeeId || t.payee === payeeId) ?? null;
}

/** YYYY-MM-DD in local time. */
export function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
