import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { principalAmount } from "../src/tasks/mortgage.js";
import { cleanPayeeName, findDuplicatePayees } from "../src/tasks/payees.js";
import { syncBalances } from "../src/tasks/portfolio.js";

describe("principalAmount", () => {
  it("subtracts the monthly interest from the payment", () => {
    // 120,000.00 owed at 5.399%: interest = 539.90, so 800.00 payment -> 260.10 principal.
    assert.equal(principalAmount(-12_000_000, -80_000, 5399), 26_010);
  });
});

describe("cleanPayeeName", () => {
  it("removes the pattern case-insensitively and collapses spaces", () => {
    assert.equal(cleanPayeeName("COMPRA  Cafe  Lisboa", "compra"), "Cafe Lisboa");
  });

  it("returns null when the name is unchanged", () => {
    assert.equal(cleanPayeeName("Cafe", "compra"), null);
  });
});

describe("findDuplicatePayees", () => {
  it("groups same-name payees, ignoring transfer payees", () => {
    const duplicates = findDuplicatePayees([
      { id: "1", name: "Cafe" },
      { id: "2", name: "Cafe" },
      { id: "3", name: "Shop" },
      { id: "4", name: "Savings", transfer_acct: "acc" },
      { id: "5", name: "Savings", transfer_acct: "acc2" },
    ]);
    assert.deepEqual(duplicates, [{ name: "Cafe", ids: ["1", "2"] }]);
  });
});

describe("syncBalances", () => {
  it("skips accounts already in sync and unknown remote accounts", async () => {
    const api = { getAccountBalance: async () => 12_345 };
    // No importTransactions call happens, so no budget is needed.
    await syncBalances(
      api,
      "Test",
      [
        { remoteAccount: "same", actualAccount: "A", payeeName: "Same" },
        { remoteAccount: "missing", actualAccount: "B", payeeName: "Missing" },
      ],
      new Map([["same", 123.45]]),
    );
  });
});
