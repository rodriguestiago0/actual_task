import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./log.js";
import { notify, parseNotificationUrls } from "./notify.js";

const DEFAULT_CRON_EXPRESSION = "0 */4 * * *";

export function stringToBoolean(value) {
  switch (value?.toLowerCase().trim()) {
    case "true":
    case "yes":
    case "1":
      return true;
    case "false":
    case "no":
    case "0":
    case "":
    case undefined:
      return false;
    default:
      throw new Error(`Invalid boolean value: "${value}"`);
  }
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variable(s): ${missing.join(", ")}`);
  }
}

/**
 * Builds [{ remoteAccount, actualAccount, payeeName }] from PREFIX_ACCOUNT / PREFIX_ACTUAL_ACCOUNT /
 * PREFIX_ACTUAL_PAYEE_NAME plus the numbered _1, _2, ... triples.
 */
export function collectAccountMapping(env, prefix) {
  const keys = (suffix) => [
    `${prefix}_ACCOUNT${suffix}`,
    `${prefix}_ACTUAL_ACCOUNT${suffix}`,
    `${prefix}_ACTUAL_PAYEE_NAME${suffix}`,
  ];
  const entry = ([account, actualAccount, payeeName]) => ({
    remoteAccount: env[account],
    actualAccount: env[actualAccount],
    payeeName: env[payeeName],
  });

  requireEnv(env, keys(""));
  const mapping = [entry(keys(""))];

  for (let i = 1; ; i++) {
    const numbered = keys(`_${i}`);
    if (numbered.some((key) => !env[key])) break;
    mapping.push(entry(numbered));
  }
  return mapping;
}

const dataDirOf = (env) => env.ACTUAL_DATA_DIR || "./temp_data_actual";
// The last configuration error notified, so a container restarting on it notifies once.
const configErrorFile = (env) => join(dataDirOf(env), "config-error");

/**
 * Logs a configuration error and notifies it through NOTIFICATION_URL when that is valid, once
 * until the error changes.
 */
export async function reportConfigError(err, env = process.env) {
  log.error(`Invalid configuration: ${err.message}`);
  let channels;
  try {
    channels = parseNotificationUrls(env.NOTIFICATION_URL);
  } catch {
    return;
  }
  const file = configErrorFile(env);
  if ((await readFile(file, "utf8").catch(() => null)) === err.message) return;
  await notify(channels, `❌ actual-tasks: invalid configuration\n${err.message}`);
  await mkdir(dataDirOf(env), { recursive: true })
    .then(() => writeFile(file, err.message))
    .catch(() => {});
}

/** Forgets the last configuration error, once the configuration is valid again. */
export const clearConfigError = (env = process.env) => rm(configErrorFile(env), { force: true });

export function loadConfig(env = process.env) {
  requireEnv(env, ["ACTUAL_SERVER_URL", "ACTUAL_SERVER_PASSWORD", "ACTUAL_SYNC_ID"]);

  const config = {
    actual: {
      serverURL: env.ACTUAL_SERVER_URL,
      password: env.ACTUAL_SERVER_PASSWORD,
      filePassword: env.ACTUAL_FILE_PASSWORD || "",
      syncId: env.ACTUAL_SYNC_ID,
      dataDir: dataDirOf(env),
    },
    cronExpression: env.CRON_EXPRESSION || DEFAULT_CRON_EXPRESSION,
    // Per-task schedules, e.g. FIX_PAYEES_CRON -> { "fix-payees": "..." }.
    taskCronExpressions: Object.fromEntries(
      Object.entries(env)
        .filter(([key, value]) => key.endsWith("_CRON") && value)
        .map(([key, value]) => [
          key.slice(0, -"_CRON".length).toLowerCase().replaceAll("_", "-"),
          value,
        ]),
    ),
    runOnStart: stringToBoolean(env.RUN_ON_START),
    notifications: parseNotificationUrls(env.NOTIFICATION_URL),
    mortgage: null,
    payeeRename: null,
    ruleMerge: stringToBoolean(env.ENABLE_RULE_MERGE),
    ghostfolio: null,
    wealthfolio: null,
    bankSync: stringToBoolean(env.ENABLE_BANK_SYNC),
  };

  if (stringToBoolean(env.ENABLE_INTEREST_CALCULATION)) {
    requireEnv(env, [
      "MORTGAGE_PAYEE_ID",
      "MORTGAGE_PAYEE_NAME",
      "MORTGAGE_ACCOUNT_ID",
      "MAIN_ACCOUNT_ID",
      "INTEREST_RATE",
    ]);
    const interestRate = Number(env.INTEREST_RATE);
    if (!Number.isFinite(interestRate)) {
      throw new Error(`INTEREST_RATE must be a number, got "${env.INTEREST_RATE}"`);
    }
    config.mortgage = {
      payeeId: env.MORTGAGE_PAYEE_ID,
      payeeName: env.MORTGAGE_PAYEE_NAME,
      mortgageAccountId: env.MORTGAGE_ACCOUNT_ID,
      mainAccountId: env.MAIN_ACCOUNT_ID,
      // Annual rate in thousandths of a percent (5399 = 5.399%).
      interestRate,
    };
  }

  if (stringToBoolean(env.ENABLE_PAYEE_RENAME)) {
    requireEnv(env, ["PAYEE_REGEX_MATCH"]);
    config.payeeRename = { regex: env.PAYEE_REGEX_MATCH };
  }

  if (stringToBoolean(env.ENABLE_GHOSTFOLIO_SYNC)) {
    requireEnv(env, ["GHOSTFOLIO_SERVER_URL"]);
    if (!env.GHOSTFOLIO_ACCESS_TOKEN && !env.GHOSTFOLIO_TOKEN) {
      throw new Error("Missing environment variable(s): GHOSTFOLIO_ACCESS_TOKEN");
    }
    config.ghostfolio = {
      serverURL: env.GHOSTFOLIO_SERVER_URL,
      // The security token, exchanged for a fresh JWT on each run. GHOSTFOLIO_TOKEN (a JWT that
      // expires after 180 days) is still accepted when it isn't set.
      accessToken: env.GHOSTFOLIO_ACCESS_TOKEN || null,
      token: env.GHOSTFOLIO_ACCESS_TOKEN ? null : env.GHOSTFOLIO_TOKEN,
      accounts: collectAccountMapping(env, "GHOSTFOLIO"),
      allowZeroBalance: stringToBoolean(env.GHOSTFOLIO_ALLOW_ZERO_BALANCE),
    };
  }

  if (stringToBoolean(env.ENABLE_WEALTHFOLIO_SYNC)) {
    requireEnv(env, ["WEALTHFOLIO_SERVER_URL"]);
    config.wealthfolio = {
      serverURL: env.WEALTHFOLIO_SERVER_URL,
      accounts: collectAccountMapping(env, "WEALTHFOLIO"),
      allowZeroBalance: stringToBoolean(env.WEALTHFOLIO_ALLOW_ZERO_BALANCE),
    };
  }

  return config;
}

/** Loads .env into process.env when present (Node's built-in replacement for dotenv). */
export function loadEnvFile(path = ".env") {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
