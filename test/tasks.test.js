import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDate } from "../src/actual.js";
import { calculateMortgage, principalAmount } from "../src/tasks/mortgage.js";
import { cleanPayeeName, findDuplicatePayees, fixPayees } from "../src/tasks/payees.js";
import { ADJUSTMENT_NOTE, syncBalances } from "../src/tasks/portfolio.js";
import { callsTo, fakeApi } from "./fake-api.js";

const today = formatDate();

describe("principalAmount", () => {
  it("subtracts the monthly interest from the payment", () => {
    // 120,000.00 owed at 5.399%: interest = 539.90, so 800.00 payment -> 260.10 principal.
    assert.equal(principalAmount(-12_000_000, -80_000, 5399), 26_010);
  });
});

describe("calculateMortgage", () => {
  const mortgage = {
    payeeId: "bank",
    payeeName: "House Loan",
    mortgageAccountId: "loan",
    mainAccountId: "main",
    interestRate: 5399,
  };

  it("records the principal when this month's payment has none yet", async () => {
    const api = fakeApi({
      transactions: { main: [{ payee: "bank", amount: -80_000, date: today }] },
      balances: { loan: -12_000_000 },
    });
    await calculateMortgage(api, mortgage);
    const [[, account, [transaction]]] = callsTo(api, "importTransactions");
    assert.equal(account, "loan");
    assert.equal(transaction.amount, 26_010);
  });

  it("does nothing when the principal is already recorded", async () => {
    const payment = { payee: "bank", amount: -80_000, date: today };
    const api = fakeApi({ transactions: { main: [payment], loan: [payment] } });
    await calculateMortgage(api, mortgage);
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });

  it("does nothing without a recent payment", async () => {
    const api = fakeApi();
    await calculateMortgage(api, mortgage);
    assert.equal(callsTo(api, "importTransactions").length, 0);
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

describe("fixPayees", () => {
  it("renames matching payees and merges the resulting duplicates", async () => {
    const api = fakeApi({
      payees: [
        { id: "1", name: "Cafe" },
        { id: "2", name: "Compra 1234 Cafe" },
      ],
    });
    await fixPayees(api, { regex: "Compra [0-9]{4}" });
    assert.deepEqual(callsTo(api, "updatePayee"), [["updatePayee", "2", { name: "Cafe" }]]);
    assert.deepEqual(callsTo(api, "mergePayees"), [["mergePayees", "1", ["2"]]]);
  });
});

describe("syncBalances", () => {
  const accounts = [{ remoteAccount: "w1", actualAccount: "A", payeeName: "Broker" }];

  it("adds a marked adjustment when the month has none", async () => {
    const api = fakeApi({ balances: { A: 10_000 } });
    await syncBalances(api, "Test", accounts, new Map([["w1", 123.45]]));
    const [[, , [transaction]]] = callsTo(api, "importTransactions");
    assert.equal(transaction.amount, 2_345);
    assert.equal(transaction.notes, ADJUSTMENT_NOTE);
  });

  it("updates this month's adjustment instead of adding another", async () => {
    const api = fakeApi({
      balances: { A: 10_000 },
      transactions: { A: [{ id: "adj", amount: 500, notes: ADJUSTMENT_NOTE }] },
    });
    await syncBalances(api, "Test", accounts, new Map([["w1", 123.45]]));
    assert.equal(callsTo(api, "importTransactions").length, 0);
    assert.deepEqual(callsTo(api, "updateTransaction"), [
      ["updateTransaction", "adj", { amount: 2_845, date: today }],
    ]);
  });

  it("skips accounts already in sync and unknown remote accounts", async () => {
    const api = fakeApi({ balances: { A: 12_345 } });
    await syncBalances(
      api,
      "Test",
      [...accounts, { remoteAccount: "missing", actualAccount: "B", payeeName: "Missing" }],
      new Map([["w1", 123.45]]),
    );
    assert.equal(callsTo(api, "importTransactions").length, 0);
    assert.equal(callsTo(api, "updateTransaction").length, 0);
  });
});
