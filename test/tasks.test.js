import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDate } from "../src/actual.js";
import { calculateMortgage, principalAmount } from "../src/tasks/mortgage.js";
import { cleanPayeeName, findDuplicatePayees, fixPayees } from "../src/tasks/payees.js";
import { syncBalances } from "../src/tasks/portfolio.js";
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
  const accounts = [{ id: "loan" }, { id: "main" }];

  it("records the principal when this month's payment has none yet", async () => {
    const api = fakeApi({
      accounts,
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
    const api = fakeApi({ accounts, transactions: { main: [payment], loan: [payment] } });
    await calculateMortgage(api, mortgage);
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });

  it("does nothing when the principal was recorded in the month after the payment", async () => {
    const api = fakeApi({
      accounts,
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
      accounts,
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
    const api = fakeApi({ accounts });
    await calculateMortgage(api, mortgage);
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });

  it("fails before reading when an account isn't open", async () => {
    const api = fakeApi({
      accounts: [{ id: "loan", closed: true }],
      transactions: { main: [{ payee: "bank", amount: -80_000, date: today }] },
    });
    await assert.rejects(
      calculateMortgage(api, mortgage),
      /^Error: Mortgage: not an open account in this budget: "loan" \(MORTGAGE_ACCOUNT_ID\), "main" \(MAIN_ACCOUNT_ID\)$/,
    );
    assert.equal(callsTo(api, "getTransactions").length, 0);
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

  it("ignores case, as Actual does when it matches payee names", () => {
    const duplicates = findDuplicatePayees([
      { id: "1", name: "Cafe" },
      { id: "2", name: "CAFE" },
      { id: "3", name: "cafe" },
    ]);
    assert.deepEqual(duplicates, [{ name: "Cafe", ids: ["1", "2", "3"] }]);
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

  it("finds the merges from the new names, even when renames aren't saved", async () => {
    const api = fakeApi({
      payees: [
        { id: "1", name: "Cafe" },
        { id: "2", name: "Compra 1234 Cafe" },
      ],
    });
    api.updatePayee = async () => {};
    await fixPayees(api, { regex: "Compra [0-9]{4}" });
    assert.deepEqual(callsTo(api, "mergePayees"), [["mergePayees", "1", ["2"]]]);
  });

  it("doesn't rename transfer payees, which keep their account's name", async () => {
    const api = fakeApi({ payees: [{ id: "1", name: "Visa 1234", transfer_acct: "visa" }] });
    await fixPayees(api, { regex: " [0-9]{4}" });
    assert.equal(callsTo(api, "updatePayee").length, 0);
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
  conditions: [{ field: "payee", op, value, type: "id" }],
  actions: [{ field: "category", op: "set", value: category, type: "id" }],
});

const payeeRule = (id, conditions, payee, conditionsOp = "and") => ({
  id,
  stage: "pre",
  conditionsOp,
  conditions: conditions.map(([op, value]) => ({
    field: "imported_payee",
    op,
    value,
    type: "string",
  })),
  actions: [{ field: "payee", op: "set", value: payee, type: "id" }],
});

const importedRule = (id, value, category) => ({
  ...categoryRule(id, "is", value, category),
  conditions: [{ field: "imported_payee", op: "is", value, type: "string" }],
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

  it("doesn't fold values on fields Actual has no is-one-of for", () => {
    const rule = (id, field, type, value) => ({
      ...categoryRule(id, "is", value, "gym"),
      conditions: [{ field, op: "is", value, type }],
    });
    const { merges } = planRuleMerges([
      rule("1", "amount", "number", -999),
      rule("2", "amount", "number", -1299),
      rule("3", "notes", "string", "gym"),
      rule("4", "notes", "string", "pool"),
      rule("5", "date", "date", "2026-01-01"),
      rule("6", "date", "date", "2026-02-01"),
    ]);
    assert.deepEqual(merges, []);
  });

  it("still deletes exact duplicates on those fields", () => {
    const rule = (id) => ({
      ...categoryRule(id, "is", -999, "gym"),
      conditions: [{ field: "amount", op: "is", value: -999, type: "number" }],
    });
    const { merges } = planRuleMerges([rule("1"), rule("2")]);
    assert.deepEqual(merges, [{ rule: rule("1"), removeIds: ["2"] }]);
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

  it("merges rules that differ only in one condition, keeping the others", () => {
    const loan = (id, payee, op = "lt") => ({
      ...categoryRule(id, "is", payee, "loan"),
      conditions: [
        { field: "payee", op: "is", value: payee, type: "id" },
        { field: "amount", op, value: 0, type: "number" },
      ],
    });
    const { merges, conflicts } = planRuleMerges([
      loan("1", "ana"),
      loan("2", "rui"),
      loan("3", "eva", "gt"),
    ]);
    assert.deepEqual(conflicts, []);
    assert.deepEqual(merges, [
      {
        rule: {
          ...loan("1", "ana"),
          conditions: [
            { field: "payee", op: "oneOf", value: ["ana", "rui"], type: "id" },
            { field: "amount", op: "lt", value: 0, type: "number" },
          ],
        },
        removeIds: ["2"],
      },
    ]);
  });

  it("leaves rules with the same other conditions alone when one value has different actions", () => {
    const rule = (id, payee, category) => ({
      ...categoryRule(id, "is", payee, category),
      conditions: [
        { field: "payee", op: "is", value: payee, type: "id" },
        { field: "amount", op: "lt", value: 0, type: "number" },
      ],
    });
    const { merges, conflicts } = planRuleMerges([
      rule("1", "cuf", "doctors"),
      rule("2", "cuf", "extra"),
      rule("3", "lusiadas", "doctors"),
    ]);
    assert.deepEqual(merges, []);
    assert.equal(conflicts.length, 1);
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

  it("leaves rules alone when merging would reorder them with a rule on another field", () => {
    // "zara lisboa" ends as gifts: zara runs after it, by id; one of zara, mango would run first
    const zaraLisboa = importedRule("a", "zara lisboa", "clothes");
    const zara = categoryRule("b", "is", "zara", "gifts");
    const mango = categoryRule("c", "is", "mango", "gifts");
    const { merges, conflicts } = planRuleMerges([zaraLisboa, zara, mango]);
    assert.deepEqual(merges, []);
    assert.deepEqual(conflicts, [{ rules: [zara, mango], reordered: [zaraLisboa] }]);
  });

  it("leaves rules alone when the kept ID would reorder them", () => {
    const zaraLisboa = importedRule("2", "zara lisboa", "clothes");
    const zara = categoryRule("1", "is", "zara", "gifts");
    const zaraAgain = categoryRule("3", "is", "zara", "gifts");
    const { merges, conflicts } = planRuleMerges([zara, zaraLisboa, zaraAgain]);
    assert.deepEqual(merges, []);
    assert.deepEqual(conflicts, [{ rules: [zara, zaraAgain], reordered: [zaraLisboa] }]);
  });

  it("leaves rules alone when merging would reorder them with a rule setting what they read", () => {
    const rename = { ...payeeRule("a", [["is", "Zara Porto"]], "zara"), stage: null };
    const zara = categoryRule("b", "is", "zara", "clothes");
    const mango = categoryRule("c", "is", "mango", "clothes");
    const { merges, conflicts } = planRuleMerges([rename, zara, mango]);
    assert.deepEqual(merges, []);
    assert.deepEqual(conflicts, [{ rules: [zara, mango], reordered: [rename] }]);
  });

  it("merges when the reordered rules can't match the same transaction", () => {
    const { merges, conflicts } = planRuleMerges([
      categoryRule("a", "is", "pingo doce", "groceries"),
      categoryRule("b", "is", "zara", "clothes"),
      categoryRule("c", "is", "mango", "clothes"),
      { ...categoryRule("d", "is", "x", "other"), actions: [{ field: "notes", op: "set" }] },
    ]);
    assert.deepEqual(conflicts, []);
    assert.equal(merges.length, 1);
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
  it("updates the kept rule and deletes the others", async () => {
    const api = fakeApi({
      rules: [
        categoryRule("1", "is", "zara", "clothes"),
        categoryRule("2", "is", "mango", "clothes"),
      ],
    });
    assert.deepEqual(await mergeRules(api), []);
    assert.equal(callsTo(api, "updateRule").length, 1);
    assert.deepEqual(callsTo(api, "deleteRule"), [["deleteRule", "2"]]);
  });

  it("returns the conflicts it left alone", async () => {
    const api = fakeApi({
      rules: [
        categoryRule("1", "is", "doce alto", "coffee"),
        categoryRule("2", "is", "doce alto", "restaurant"),
      ],
    });
    const [conflict, ...rest] = await mergeRules(api);
    assert.equal(rest.length, 0);
    assert.match(conflict, /Not merging 2 rules that can match "doce alto"/);
    assert.equal(callsTo(api, "updateRule").length, 0);
  });
  it("returns the merges it left alone to keep the rule order", async () => {
    const api = fakeApi({
      rules: [
        importedRule("a", "zara lisboa", "clothes"),
        categoryRule("b", "is", "zara", "gifts"),
        categoryRule("c", "is", "mango", "gifts"),
      ],
    });
    const [conflict, ...rest] = await mergeRules(api);
    assert.equal(rest.length, 0);
    assert.match(conflict, /Not merging 2 rules, as it would change their order/);
    assert.match(conflict, /with: if imported_payee is "zara lisboa"/);
    assert.equal(callsTo(api, "updateRule").length, 0);
  });
});

describe("syncBalances", () => {
  const accounts = [{ remoteAccount: "w1", actualAccount: "A", payeeName: "Broker" }];
  const open = [{ id: "A" }, { id: "B" }];

  it("adds an adjustment for the difference", async () => {
    const api = fakeApi({ accounts: open, balances: { A: 10_000 } });
    await syncBalances(api, "Test", accounts, new Map([["w1", 123.45]]));
    assert.deepEqual(callsTo(api, "importTransactions"), [
      [
        "importTransactions",
        "A",
        [{ date: today, amount: 2_345, payee_name: "Broker", forceAddTransaction: true }],
        { payeeNameNormalization: "original" },
      ],
    ]);
  });

  it("adds another adjustment instead of changing an earlier one", async () => {
    const api = fakeApi({
      accounts: open,
      balances: { A: 10_000 },
      transactions: { A: [{ id: "adj", amount: 500, payee: "broker", date: today }] },
    });
    await syncBalances(api, "Test", accounts, new Map([["w1", 123.45]]));
    assert.equal(callsTo(api, "importTransactions").length, 1);
    assert.equal(callsTo(api, "updateTransaction").length, 0);
  });

  it("fails when Actual rejects the adjustment", async () => {
    const api = fakeApi({ accounts: open, balances: { A: 10_000 } });
    api.importTransactions = async () => ({
      added: [],
      updated: [],
      errors: [{ message: "Amount is invalid" }],
    });
    await assert.rejects(
      syncBalances(api, "Test", accounts, new Map([["w1", 123.45]])),
      /Import into A failed: Amount is invalid/,
    );
  });

  it("skips accounts already in sync and warns about unknown remote accounts", async () => {
    const api = fakeApi({ accounts: open, balances: { A: 12_345 } });
    const warnings = await syncBalances(
      api,
      "Test",
      [...accounts, { remoteAccount: "missing", actualAccount: "B", payeeName: "Missing" }],
      new Map([["w1", 123.45]]),
    );
    assert.deepEqual(warnings, ["Test account missing not found"]);
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });

  it("skips an account whose balance is hidden instead of syncing it to 0", async () => {
    const api = fakeApi({ accounts: open, balances: { A: 12_345 } });
    const warnings = await syncBalances(api, "Test", accounts, new Map([["w1", null]]));
    assert.deepEqual(warnings, ["Test returned no balance for account w1"]);
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });

  it("fails before syncing when an Actual account isn't open", async () => {
    const api = fakeApi({ accounts: [{ id: "A" }, { id: "B", closed: true }] });
    await assert.rejects(
      syncBalances(
        api,
        "Test",
        [...accounts, { remoteAccount: "w2", actualAccount: "B", payeeName: "Other" }],
        new Map([["w1", 123.45]]),
      ),
      /^Error: Test: not an open account in this budget: "B" \(for Test account w2\)\. Check the TEST_ACTUAL_ACCOUNT variables$/,
    );
    assert.equal(callsTo(api, "getAccountBalance").length, 0);
    assert.equal(callsTo(api, "importTransactions").length, 0);
  });
});
