import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as actualApi from "@actual-app/api";
import { isRunning, withLock } from "./lock.js";
import { log } from "./log.js";

// Errors from Actual (err.code) that are worth retrying a little later, and how much later.
const RETRIED = new Set(["network-failure", "timeout"]);
const RETRY_DELAYS_MS = [10_000, 30_000];

// This process's run directories, with when each run finished (null while it runs).
const runs = new Map();
// Actual can still write a budget's metadata.json just after shutdown() (it doesn't await it), and
// fails loudly if the directory is gone, so a run's directory is only removed a while later.
const KEEP_FINISHED_RUN_MS = 60_000;

/**
 * Removes what earlier runs left in dataDir: directories of runs by processes that are gone (or by
 * this one, a while after they finished), and the budget copy of versions before run directories.
 * Called holding the lock, so no other run is using them.
 */
async function removeOldRuns(dataDir, syncId) {
  await rm(join(dataDir, syncId), { recursive: true, force: true });
  for (const entry of await readdir(dataDir)) {
    const pid = Number(/^run-(\d+)-/.exec(entry)?.[1]);
    if (!pid) continue;
    const dir = join(dataDir, entry);
    const finished = runs.get(dir);
    const old =
      pid === process.pid
        ? finished === undefined ||
          (finished !== null && Date.now() - finished > KEEP_FINISHED_RUN_MS)
        : !isRunning(pid);
    if (old) {
      await rm(dir, { recursive: true, force: true });
      runs.delete(dir);
    }
  }
}

/**
 * Removes the budget's (decrypted) databases from a run directory, db.sqlite and the spreadsheet's
 * cache.sqlite, leaving Actual's metadata.
 */
async function removeDatabases(dir) {
  const files = await readdir(dir, { recursive: true }).catch(() => []);
  await Promise.all(
    files
      .filter((file) => /\.sqlite\b/.test(basename(file)))
      .map((file) => rm(join(dir, file), { force: true })),
  );
}

/** A new directory for one run, removed by a later run or when the process exits. */
async function newRunDir(dataDir) {
  if (runs.size === 0) {
    process.once("exit", () => {
      for (const dir of runs.keys()) rmSync(dir, { recursive: true, force: true });
    });
  }
  const dir = await mkdtemp(join(dataDir, `run-${process.pid}-`));
  runs.set(dir, null);
  return dir;
}

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
 * Downloads a fresh copy of the budget into a new directory under dataDir, runs fn(api), then
 * syncs and always shuts down, returning fn's result. A lock file in dataDir keeps runs from
 * separate processes apart, and the budget's database is removed once the run is over, as for an
 * end-to-end encrypted budget it's the decrypted copy. Opening the budget is retried after a
 * network failure. Actual pushes each change to the server about a second after it's made, and
 * shutdown() pushes what's left, so a task that fails halfway keeps the changes it made. The
 * explicit sync is still needed: it's the only one that reports a failed push (shutdown() ignores
 * sync errors). In a dry run, fn gets an API that can't change the budget, and the task's changes
 * aren't synced. Actual's own schedule service still runs while the budget downloads, though: it
 * posts due "automatically add" schedules and syncs them, as opening the app would.
 */
export async function withBudget(config, fn, api = actualApi) {
  await mkdir(config.dataDir, { recursive: true });
  return withLock(join(config.dataDir, "lock"), async () => {
    await removeOldRuns(config.dataDir, config.syncId);
    const budgetDir = await newRunDir(config.dataDir);
    try {
      return await openBudget({ ...config, budgetDir }, fn, api);
    } finally {
      await removeDatabases(budgetDir);
      runs.set(budgetDir, Date.now());
    }
  });
}

async function openBudget(
  {
    serverURL,
    password,
    filePassword,
    syncId,
    budgetDir,
    dryRun = false,
    retryDelaysMs = RETRY_DELAYS_MS,
  },
  fn,
  api,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await api.init({ serverURL, password, dataDir: budgetDir });
      await api.downloadBudget(syncId, filePassword ? { password: filePassword } : {});
      break;
    } catch (err) {
      await api.shutdown().catch(() => {});
      const delay = retryDelaysMs[attempt];
      if (delay === undefined || !RETRIED.has(err?.code)) {
        throw new Error(`Actual Budget error: ${err.message}`, { cause: err });
      }
      log.warn(`Actual Budget error: ${err.message}; retrying in ${delay / 1000} s`);
      await sleep(delay);
    }
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
