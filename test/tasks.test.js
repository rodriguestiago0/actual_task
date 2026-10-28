import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDate } from "../src/actual.js";
import { calculateMortgage, principalAmount } from "../src/tasks/mortgage.js";
import { cleanPayeeName, findDuplicatePayees, fixPayees } from "../src/tasks/payees.js";
import { ADJUSTMENT_NOTE, syncBalances } from "../src/tasks/portfolio.js";
import { mergeRules, planRuleMerges } from "../src/tasks/rules.js";
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

  it("does nothing when the principal was recorded in the month after the payment", async () => {
    const api = fakeApi({
      transactions: {
        main: [{ payee: "bank", amount: -80_000, date: "2026-09-30" }],
        loan: [{ payee: "bank", amount: 26_010, date: "2026-10-01" }],
      },
    });
    await calculateMortgage(api, mortgage);
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });

  it("uses the newest payment and principal regardless of order", async () => {
    const api = fakeApi({
      transactions: {
        main: [
          { payee: "bank", amount: -80_000, date: "2026-09-30" },
          { payee: "bank", amount: -80_000, date: "2026-10-30" },
        ],
        loan: [{ payee: "bank", amount: 26_010, date: "2026-10-01" }],
      },
      balances: { loan: -12_000_000 },
    });
    await calculateMortgage(api, mortgage);
    assert.equal(callsTo(api, "importTransactions").length, 1);
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

  it("matches payee names case-insensitively", async () => {
    const api = fakeApi({ payees: [{ id: "1", name: "compra 1234 Cafe" }] });
    await fixPayees(api, { regex: "Compra [0-9]{4}" });
    assert.deepEqual(callsTo(api, "updatePayee"), [["updatePayee", "1", { name: "Cafe" }]]);
  });
});

const categoryRule = (id, op, value, category, stage = null) => ({
  id,
  stage,
  conditionsOp: "and",
  conditions: [{ field: "description", op, value, type: "id" }],
  actions: [{ field: "category", op: "set", value: category, type: "id" }],
});

const payeeRule = (id, conditions, payee, conditionsOp = "and") => ({
  id,
  stage: "pre",
  conditionsOp,
  conditions: conditions.map(([op, value]) => ({
    field: "imported_description",
    op,
    value,
    type: "string",
  })),
  actions: [{ field: "description", op: "set", value: payee, type: "id" }],
});

describe("planRuleMerges", () => {
  it("merges rules with the same actions into one is-one-of rule", () => {
    const { merges, conflicts } = planRuleMerges([
      categoryRule("2", "is", "mango", "clothes"),
      categoryRule("1", "is", "zara", "clothes"),
      categoryRule("3", "oneOf", ["zara", "asos"], "clothes"),
      categoryRule("4", "is", "cafe", "coffee"),
    ]);
    assert.deepEqual(conflicts, []);
    assert.deepEqual(merges, [
      {
        rule: categoryRule("1", "oneOf", ["mango", "zara", "asos"], "clothes"),
        removeIds: ["2", "3"],
      },
    ]);
  });

  it("merges contains rules with an or", () => {
    const { merges } = planRuleMerges([
      payeeRule("1", [["is", "Compra Zara Porto"]], "zara"),
      payeeRule("2", [["contains", "ZARA LISBOA"]], "zara"),
      payeeRule(
        "3",
        [
          ["oneOf", ["Zara Online", "compra zara porto"]],
          ["contains", "Zara Pt"],
        ],
        "zara",
        "or",
      ),
    ]);
    assert.deepEqual(merges, [
      {
        rule: payeeRule(
          "1",
          [
            ["oneOf", ["Compra Zara Porto", "Zara Online"]],
            ["contains", "ZARA LISBOA"],
            ["contains", "Zara Pt"],
          ],
          "zara",
          "or",
        ),
        removeIds: ["2", "3"],
      },
    ]);
  });

  it("treats empty action options as none", () => {
    const rule = categoryRule("1", "is", "zara", "clothes");
    const { merges } = planRuleMerges([
      rule,
      {
        ...categoryRule("2", "is", "mango", "clothes"),
        actions: [{ ...rule.actions[0], options: { splitIndex: 0 } }],
      },
    ]);
    assert.equal(merges.length, 1);
  });

  it("does not fold rules whose conditions must all match", () => {
    const { merges } = planRuleMerges([
      payeeRule("1", [["contains", "Zara"]], "zara"),
      payeeRule(
        "2",
        [
          ["contains", "Zara"],
          ["contains", "Online"],
        ],
        "zara",
      ),
    ]);
    assert.deepEqual(merges, []);
  });

  it("does not merge across stages", () => {
    const { merges } = planRuleMerges([
      categoryRule("1", "is", "zara", "clothes"),
      categoryRule("2", "is", "mango", "clothes", "pre"),
    ]);
    assert.deepEqual(merges, []);
  });

  it("leaves rules alone when they match the same value with different actions", () => {
    const doce = categoryRule("1", "is", "doce", "coffee");
    const doceRestaurant = categoryRule("2", "is", "doce", "restaurant");
    const { merges, conflicts } = planRuleMerges([
      doce,
      doceRestaurant,
      categoryRule("3", "is", "ola", "coffee"),
      categoryRule("4", "is", "pans", "restaurant"),
    ]);
    assert.deepEqual(merges, []);
    assert.deepEqual(conflicts, [{ value: "doce", rules: [doce, doceRestaurant] }]);
  });

  it("leaves rules alone when a contains value is found in another payee's value", () => {
    const continente = payeeRule("1", [["contains", "Continente"]], "continente");
    const bomDia = payeeRule("2", [["is", "Continente Bom Dia"]], "bom-dia");
    const { merges, conflicts } = planRuleMerges([
      continente,
      bomDia,
      payeeRule("3", [["contains", "Modelo"]], "continente"),
      payeeRule("4", [["is", "Bom Dia Porto"]], "bom-dia"),
    ]);
    assert.deepEqual(merges, []);
    assert.deepEqual(conflicts, [{ value: "continente", rules: [continente, bomDia] }]);
  });

  it("deletes exact duplicates of other rules", () => {
    const rule = (id) => ({
      ...payeeRule(
        id,
        [
          ["contains", "Cambao"],
          ["contains", "Joaquim"],
        ],
        "p",
      ),
    });
    assert.deepEqual(planRuleMerges([rule("2"), rule("1")]).merges, [
      { rule: rule("1"), removeIds: ["2"] },
    ]);
  });
});

describe("mergeRules", () => {
  const rules = () => [
    categoryRule("1", "is", "zara", "clothes"),
    categoryRule("2", "is", "mango", "clothes"),
  ];

  it("updates the kept rule and deletes the others", async () => {
    const api = fakeApi({ rules: rules() });
    await mergeRules(api, { dryRun: false });
    assert.equal(callsTo(api, "updateRule").length, 1);
    assert.deepEqual(callsTo(api, "deleteRule"), [["deleteRule", "2"]]);
  });

  it("changes nothing in a dry run", async () => {
    const api = fakeApi({ rules: rules() });
    await mergeRules(api, { dryRun: true });
    assert.deepEqual(callsTo(api, "updateRule"), []);
    assert.deepEqual(callsTo(api, "deleteRule"), []);
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
