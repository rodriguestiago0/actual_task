import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringToBoolean } from "./bool.js";
import { log } from "./log.js";
import { notify, parseNotificationUrls } from "./notify.js";

export { stringToBoolean };

const DEFAULT_CRON_EXPRESSION = "0 */4 * * *";

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

  let i = 1;
  for (; ; i++) {
    const numbered = keys(`_${i}`);
    if (numbered.some((key) => !env[key])) break;
    mapping.push(entry(numbered));
  }
  // Numbering stops at the first incomplete set, so anything numbered after it is ignored.
  const numbered = new RegExp(`^${prefix}_(?:ACCOUNT|ACTUAL_ACCOUNT|ACTUAL_PAYEE_NAME)_(\\d+)$`);
  const ignored = Object.keys(env)
    .filter((key) => env[key] && Number(numbered.exec(key)?.[1]) >= i)
    .sort();
  if (ignored.length > 0) {
    log.warn(`Ignoring ${ignored.join(", ")}: ${keys(`_${i}`).join(", ")} must all be set first`);
  }
  return mapping;
}

/**
 * The environment with each NAME_FILE variable replaced by NAME, read from that file (Docker and
 * Compose secrets), so secrets don't have to be in the container's environment.
 */
export function withFileSecrets(env) {
  const resolved = { ...env };
  for (const [key, path] of Object.entries(env)) {
    if (!key.endsWith("_FILE") || !path) continue;
    const name = key.slice(0, -"_FILE".length);
    if (env[name]) throw new Error(`Set ${name} or ${key}, not both`);
    try {
      resolved[name] = readFileSync(path, "utf8").replace(/\r?\n$/, "");
    } catch (err) {
      throw new Error(`${key}: can't read ${path} (${err.code ?? err.message})`, { cause: err });
    }
  }
  return resolved;
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
    channels = parseNotificationUrls(withFileSecrets(env).NOTIFICATION_URL);
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

/** A whole number of minutes, 0 to turn it off. */
function minutes(env, name, fallback) {
  if (!env[name]) return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number of minutes, got "${env[name]}"`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  env = withFileSecrets(env);
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
    taskTimeoutMinutes: minutes(env, "TASK_TIMEOUT_MINUTES", 30),
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
    // A rate written as a percentage (5.399) would be read as 0.005399%.
    if (!Number.isInteger(interestRate) || interestRate <= 0 || interestRate >= 100_000) {
      throw new Error(
        "INTEREST_RATE must be the annual rate in % multiplied by 1000 (5.399% is 5399), " +
          `got "${env.INTEREST_RATE}"`,
      );
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
    try {
      new RegExp(env.PAYEE_REGEX_MATCH, "gis");
    } catch (err) {
      throw new Error(`PAYEE_REGEX_MATCH is not a valid regex: ${err.message}`, { cause: err });
    }
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
