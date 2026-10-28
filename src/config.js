import { parseNotificationUrls } from "./notify.js";

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

export function loadConfig(env = process.env) {
  requireEnv(env, ["ACTUAL_SERVER_URL", "ACTUAL_SERVER_PASSWORD", "ACTUAL_SYNC_ID"]);

  const config = {
    actual: {
      serverURL: env.ACTUAL_SERVER_URL,
      password: env.ACTUAL_SERVER_PASSWORD,
      filePassword: env.ACTUAL_FILE_PASSWORD || "",
      syncId: env.ACTUAL_SYNC_ID,
      dataDir: env.ACTUAL_DATA_DIR || "./temp_data_actual",
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
    ruleMerge: null,
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

  if (stringToBoolean(env.ENABLE_RULE_MERGE)) {
    config.ruleMerge = { dryRun: stringToBoolean(env.RULE_MERGE_DRY_RUN) };
  }

  if (stringToBoolean(env.ENABLE_GHOSTFOLIO_SYNC)) {
    requireEnv(env, ["GHOSTFOLIO_SERVER_URL", "GHOSTFOLIO_TOKEN"]);
    config.ghostfolio = {
      serverURL: env.GHOSTFOLIO_SERVER_URL,
      token: env.GHOSTFOLIO_TOKEN,
      accounts: collectAccountMapping(env, "GHOSTFOLIO"),
    };
  }

  if (stringToBoolean(env.ENABLE_WEALTHFOLIO_SYNC)) {
    requireEnv(env, ["WEALTHFOLIO_SERVER_URL"]);
    config.wealthfolio = {
      serverURL: env.WEALTHFOLIO_SERVER_URL,
      accounts: collectAccountMapping(env, "WEALTHFOLIO"),
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
