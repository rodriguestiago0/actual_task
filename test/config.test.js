import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { collectAccountMapping, loadConfig, stringToBoolean } from "../src/config.js";
import { log } from "../src/log.js";

const base = {
  ACTUAL_SERVER_URL: "https://actual.example",
  ACTUAL_SERVER_PASSWORD: "secret",
  ACTUAL_SYNC_ID: "sync-id",
};

describe("stringToBoolean", () => {
  it("parses truthy and falsy values", () => {
    for (const value of ["true", "YES", " 1 "]) assert.equal(stringToBoolean(value), true);
    for (const value of ["false", "no", "0", "", undefined]) {
      assert.equal(stringToBoolean(value), false);
    }
  });

  it("rejects unknown values", () => {
    assert.throws(() => stringToBoolean("maybe"), /Invalid boolean/);
  });
});

describe("collectAccountMapping", () => {
  it("collects base and numbered triples until the first incomplete one", () => {
    const mapping = collectAccountMapping(
      {
        X_ACCOUNT: "a",
        X_ACTUAL_ACCOUNT: "A",
        X_ACTUAL_PAYEE_NAME: "Pa",
        X_ACCOUNT_1: "b",
        X_ACTUAL_ACCOUNT_1: "B",
        X_ACTUAL_PAYEE_NAME_1: "Pb",
        X_ACCOUNT_2: "c",
        X_ACTUAL_ACCOUNT_2: "C",
      },
      "X",
    );
    assert.deepEqual(mapping, [
      { remoteAccount: "a", actualAccount: "A", payeeName: "Pa" },
      { remoteAccount: "b", actualAccount: "B", payeeName: "Pb" },
    ]);
  });

  it("warns about numbered variables after the first incomplete set", (t) => {
    const warn = mock.method(log, "warn", () => {});
    t.after(() => warn.mock.restore());
    const mapping = collectAccountMapping(
      {
        X_ACCOUNT: "a",
        X_ACTUAL_ACCOUNT: "A",
        X_ACTUAL_PAYEE_NAME: "Pa",
        X_ACCOUNT_2: "c",
        X_ACTUAL_ACCOUNT_2: "C",
        X_ACTUAL_PAYEE_NAME_2: "Pc",
      },
      "X",
    );
    assert.equal(mapping.length, 1);
    assert.deepEqual(warn.mock.calls[0].arguments, [
      "Ignoring X_ACCOUNT_2, X_ACTUAL_ACCOUNT_2, X_ACTUAL_PAYEE_NAME_2: " +
        "X_ACCOUNT_1, X_ACTUAL_ACCOUNT_1, X_ACTUAL_PAYEE_NAME_1 must all be set first",
    ]);
  });

  it("requires the base triple", () => {
    assert.throws(
      () => collectAccountMapping({ X_ACCOUNT: "a", X_ACTUAL_ACCOUNT: "A" }, "X"),
      /X_ACTUAL_PAYEE_NAME/,
    );
  });
});

describe("loadConfig", () => {
  it("requires Actual settings", () => {
    assert.throws(() => loadConfig({}), /ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD/);
  });

  it("leaves disabled tasks unset and applies defaults", () => {
    const config = loadConfig(base);
    assert.equal(config.mortgage, null);
    assert.equal(config.wealthfolio, null);
    assert.equal(config.bankSync, false);
    assert.equal(config.cronExpression, "0 */4 * * *");
  });

  it("validates the mortgage settings", () => {
    const env = {
      ...base,
      ENABLE_INTEREST_CALCULATION: "true",
      MORTGAGE_PAYEE_ID: "p",
      MORTGAGE_PAYEE_NAME: "Mortgage",
      MORTGAGE_ACCOUNT_ID: "m",
      MAIN_ACCOUNT_ID: "main",
      INTEREST_RATE: "5399",
    };
    assert.equal(loadConfig(env).mortgage.interestRate, 5399);
    for (const rate of ["abc", "5.399", "0", "-5399", "100000"]) {
      assert.throws(
        () => loadConfig({ ...env, INTEREST_RATE: rate }),
        /INTEREST_RATE must be the annual rate in % multiplied by 1000 \(5\.399% is 5399\)/,
      );
    }
    assert.throws(() => loadConfig({ ...env, MAIN_ACCOUNT_ID: "" }), /MAIN_ACCOUNT_ID/);
  });

  it("rejects an invalid PAYEE_REGEX_MATCH at startup", () => {
    const env = { ...base, ENABLE_PAYEE_RENAME: "true" };
    assert.equal(
      loadConfig({ ...env, PAYEE_REGEX_MATCH: "Compra [0-9]{4}" }).payeeRename.regex,
      "Compra [0-9]{4}",
    );
    assert.throws(
      () => loadConfig({ ...env, PAYEE_REGEX_MATCH: "Compra [0-9" }),
      /PAYEE_REGEX_MATCH is not a valid regex/,
    );
  });

  it("configures rule merging", () => {
    assert.equal(loadConfig(base).ruleMerge, false);
    assert.equal(loadConfig({ ...base, ENABLE_RULE_MERGE: "true" }).ruleMerge, true);
  });

  it("configures Ghostfolio with the security token, falling back to GHOSTFOLIO_TOKEN", () => {
    const env = {
      ...base,
      ENABLE_GHOSTFOLIO_SYNC: "true",
      GHOSTFOLIO_SERVER_URL: "https://gf.example",
      GHOSTFOLIO_ACCOUNT: "g",
      GHOSTFOLIO_ACTUAL_ACCOUNT: "A",
      GHOSTFOLIO_ACTUAL_PAYEE_NAME: "Invest",
    };
    assert.throws(() => loadConfig(env), /GHOSTFOLIO_ACCESS_TOKEN/);

    const withAccess = loadConfig({ ...env, GHOSTFOLIO_ACCESS_TOKEN: "s", GHOSTFOLIO_TOKEN: "j" });
    assert.equal(withAccess.ghostfolio.accessToken, "s");
    assert.equal(withAccess.ghostfolio.token, null);

    const legacy = loadConfig({ ...env, GHOSTFOLIO_TOKEN: "j" });
    assert.equal(legacy.ghostfolio.accessToken, null);
    assert.equal(legacy.ghostfolio.token, "j");
  });

  it("configures Wealthfolio", () => {
    const config = loadConfig({
      ...base,
      ENABLE_WEALTHFOLIO_SYNC: "true",
      WEALTHFOLIO_SERVER_URL: "https://wf.example",
      WEALTHFOLIO_ACCOUNT: "w",
      WEALTHFOLIO_ACTUAL_ACCOUNT: "A",
      WEALTHFOLIO_ACTUAL_PAYEE_NAME: "Invest",
    });
    assert.equal(config.wealthfolio.accounts.length, 1);
  });
});

describe("loadConfig scheduling and notifications", () => {
  it("collects per-task cron overrides and RUN_ON_START", () => {
    const config = loadConfig({ ...base, FIX_PAYEES_CRON: "*/5 * * * *", RUN_ON_START: "true" });
    assert.deepEqual(config.taskCronExpressions, { "fix-payees": "*/5 * * * *" });
    assert.equal(config.runOnStart, true);
  });

  it("reads TASK_TIMEOUT_MINUTES, 30 by default", () => {
    assert.equal(loadConfig(base).taskTimeoutMinutes, 30);
    assert.equal(loadConfig({ ...base, TASK_TIMEOUT_MINUTES: "0" }).taskTimeoutMinutes, 0);
    assert.throws(() => loadConfig({ ...base, TASK_TIMEOUT_MINUTES: "1.5" }), /whole number/);
  });

  it("parses NOTIFICATION_URL", () => {
    assert.deepEqual(loadConfig(base).notifications, []);
    const config = loadConfig({ ...base, NOTIFICATION_URL: "ntfy://ntfy.sh/a discord://t@1" });
    assert.deepEqual(
      config.notifications.map((channel) => channel.name),
      ["ntfy", "discord"],
    );
    assert.throws(() => loadConfig({ ...base, NOTIFICATION_URL: "x://y" }), /unsupported/);
  });
});
