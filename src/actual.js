import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import * as actualApi from "@actual-app/api";
import { log } from "./log.js";

// API calls that only read, made as usual in a dry run.
const READS = /^(get|aqlQuery$|runQuery$|q$)/;

/**
 * The API with every call that would change the budget skipped and counted in `skipped`, except
 * importTransactions, which runs as Actual's preview so its result can still be logged. Its
 * `dryRun` is true, so helpers can say what would happen instead of what did.
 */
export function dryRunApi(api, skipped) {
  const wrap = (name, value) => {
    if (typeof value !== "function" || READS.test(name)) return value;
    if (name === "importTransactions") {
      return (accountId, transactions, opts) =>
        api.importTransactions(accountId, transactions, {
          defaultCleared: true,
          ...opts,
          dryRun: true,
        });
    }
    return async () => {
      skipped.set(name, (skipped.get(name) ?? 0) + 1);
    };
  };
  return {
    ...Object.fromEntries(Object.entries(api).map(([name, value]) => [name, wrap(name, value)])),
    dryRun: true,
  };
}

/**
 * Downloads a fresh copy of the budget, runs fn(api), then syncs and always shuts down, returning
 * fn's result. Actual pushes each change to the server about a second after it's made, and
 * shutdown() pushes what's left, so a task that fails halfway keeps the changes it made. The
 * explicit sync is still needed: it's the only one that reports a failed push (shutdown() ignores
 * sync errors). In a dry run, fn gets an API that can't change the budget, and the task's changes
 * aren't synced. Actual's own schedule service still runs while the budget downloads, though: it
 * posts due "automatically add" schedules and syncs them, as opening the app would.
 */
export async function withBudget(
  { serverURL, password, filePassword, syncId, dataDir, dryRun = false },
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

  const skipped = new Map();
  let result;
  try {
    if (dryRun) {
      result = await fn(dryRunApi(api, skipped));
      const calls = [...skipped].map(([name, count]) => `${name} ×${count}`).join(", ");
      log.info(`Dry run: the task saved nothing${calls ? ` (skipped ${calls})` : ""}`);
    } else {
      result = await fn(api);
      await api.sync();
    }
  } catch (err) {
    await api.shutdown().catch(() => {});
    throw err;
  }
  // Everything is synced by now, so a failure here doesn't fail the task.
  await api.shutdown().catch((err) => log.warn("Actual shutdown failed:", err.message));
  return result;
}

/**
 * Throws unless every account id is an open account in the budget. Actual imports into an unknown
 * id without an error, as transactions no account shows, again on every run. accounts is a list of
 * [label, id], the label saying where the id is configured; hint is added to the error.
 */
export async function requireOpenAccounts(api, task, accounts, hint) {
  const open = new Set(
    (await api.getAccounts()).filter((account) => !account.closed).map((account) => account.id),
  );
  const unknown = accounts.filter(([, id]) => !open.has(id));
  if (unknown.length > 0) {
    const list = unknown.map(([label, id]) => `"${id}" (${label})`);
    throw new Error(
      `${task}: not an open account in this budget: ${list.join(", ")}${hint ? `. ${hint}` : ""}`,
    );
  }
}

/** Imports transactions, throwing when Actual reports errors (it returns them instead). */
export async function importTransactions(api, accountId, transactions, opts) {
  log.debug("Transactions to import:", transactions);
  const result = await api.importTransactions(accountId, transactions, opts);
  log.info(
    `${api.dryRun ? "Would import" : "Imported"} into ${accountId}: ` +
      `${result.added.length} added, ${result.updated.length} updated`,
  );
  if (result.errors?.length) {
    throw new Error(
      `Import into ${accountId} failed: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }
}

/** Most recent transaction in the last month, optionally filtered by payee. */
export async function getLastTransaction(api, accountId, payeeId) {
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const transactions = await api.getTransactions(accountId, formatDate(monthAgo), formatDate());
  return (
    transactions
      .filter((t) => !payeeId || t.payee === payeeId)
      .toSorted((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

/** YYYY-MM-DD in local time. */
export function formatDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
