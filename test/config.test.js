import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectAccountMapping, loadConfig, stringToBoolean } from "../src/config.js";

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
    assert.throws(() => loadConfig({ ...env, INTEREST_RATE: "abc" }), /must be a number/);
    assert.throws(() => loadConfig({ ...env, MAIN_ACCOUNT_ID: "" }), /MAIN_ACCOUNT_ID/);
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
