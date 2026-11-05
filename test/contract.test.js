// The same scenarios against the fake API and against the real @actual-app/api on a local budget
// (no server), so the fake can't drift from what the tasks get from Actual.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import * as actualApi from "@actual-app/api";
import { formatDate } from "../src/actual.js";
import { calculateMortgage } from "../src/tasks/mortgage.js";
import { fixPayees } from "../src/tasks/payees.js";
import { syncBalances } from "../src/tasks/portfolio.js";
import { mergeRules } from "../src/tasks/rules.js";
import { fakeApi } from "./fake-api.js";

const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return formatDate(date);
};
const today = day(0);

/**
 * A budget is described by names: accounts [{ name, balance, closed }], payees and categories
 * [name], and transactions(id) and rules(id) built with id(name) for the entity's id.
 */
const fake = {
  name: "fake",
  async budget({ accounts = [], payees = [], categories = [], transactions, rules }) {
    const id = (name) => name;
    const entities = (names) => names.map((name) => ({ id: name, name }));
    const api = fakeApi({
      accounts: accounts.map(({ name, closed = false }) => ({ id: name, name, closed })),
      balances: Object.fromEntries(accounts.map(({ name, balance = 0 }) => [name, balance])),
      payees: entities(payees).map((payee) => ({ ...payee, transfer_acct: null })),
      categories: entities(categories),
      transactions: Object.groupBy(transactions?.(id) ?? [], (t) => t.account),
    });
    for (const rule of rules?.(id) ?? []) await api.createRule(rule);
    return { api, id };
  },
};

let budgets = 0;
const real = {
  name: "real",
  async start() {
    // the API logs every step through console
    for (const method of ["log", "info", "debug", "warn"]) mock.method(console, method, () => {});
    this.dir = await mkdtemp(join(tmpdir(), "actual-contract-"));
    // The API writes metadata.json without awaiting it (savePrefs from the sync listener), so it
    // can still be writing after shutdown(). Remove the budgets only once the process is done.
    const dir = this.dir;
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    await actualApi.init({ dataDir: this.dir });
  },
  async stop() {
    await actualApi.shutdown();
    mock.restoreAll();
  },
  async budget({ accounts = [], payees = [], categories = [], transactions, rules }) {
    const ids = new Map();
    await actualApi.runImport(`contract-${++budgets}`, async () => {
      for (const { name, balance = 0 } of accounts) {
        ids.set(name, await actualApi.createAccount({ name }, balance));
      }
      for (const name of payees) ids.set(name, await actualApi.createPayee({ name }));
      if (categories.length > 0) {
        const group_id = await actualApi.createCategoryGroup({ name: "Group" });
        for (const name of categories) {
          ids.set(name, await actualApi.createCategory({ name, group_id }));
        }
      }
    });
    const id = (name) => {
      assert.ok(ids.has(name), `no ${name} in the budget`);
      return ids.get(name);
    };
    for (const { name } of accounts.filter((account) => account.closed)) {
      await actualApi.closeAccount(id(name));
    }
    for (const [account, list] of Map.groupBy(transactions?.(id) ?? [], (t) => t.account)) {
      await actualApi.addTransactions(account, list);
    }
    for (const rule of rules?.(id) ?? []) await actualApi.createRule(rule);
    return { api: actualApi, id };
  },
};

/** What the tasks change, by name: payees, an account's transactions and the rules. */
async function view(api) {
  const payees = await api.getPayees();
  const names = new Map(
    [...payees, ...(await api.getCategories()), ...(await api.getAccounts())].map((e) => [
      e.id,
      e.name,
    ]),
  );
  const named = (value) =>
    Array.isArray(value) ? value.map(named).sort() : (names.get(value) ?? value);
  const part = ({ field, op, value, type }) => ({ field, op, value: named(value), type });
  return {
    payees: payees
      .filter((p) => !p.transfer_acct && p.name !== "Starting Balance")
      .map((p) => p.name)
      .sort(),
    transferPayees: payees.filter((p) => p.transfer_acct).map((p) => p.name),
    transactions: async (account) =>
      (await api.getTransactions(account))
        .filter((t) => !t.starting_balance_flag)
        .map(({ date, amount, payee }) => ({ date, amount, payee: named(payee) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount),
    rules: (await api.getRules())
      .map(({ stage, conditionsOp, conditions, actions }) => ({
        stage,
        conditionsOp,
        conditions: conditions.map(part),
        actions: actions.map(part),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

const rule = (conditions, actions, extra = {}) => ({
  stage: null,
  conditionsOp: "and",
  conditions,
  actions,
  ...extra,
});

for (const backend of [fake, real]) {
  describe(`API contract (${backend.name})`, () => {
    if (backend.start) {
      before(() => backend.start());
      after(() => backend.stop());
    }

    it("getTransactions keeps the dates in the range, both ends included", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Main" }],
        transactions: (id) =>
          ["2026-10-01", "2026-10-15", "2026-10-31", "2026-11-01"].map((date) => ({
            account: id("Main"),
            date,
            amount: 100,
          })),
      });
      const dates = (list) => list.map((t) => t.date).sort();
      assert.deepEqual(dates(await api.getTransactions(id("Main"), "2026-10-15", "2026-10-31")), [
        "2026-10-15",
        "2026-10-31",
      ]);
    });

    it("getAccountBalance sums transactions up to today, and is 0 for an unknown id", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Main", balance: 1_000 }],
        transactions: (id) => [
          { account: id("Main"), date: day(-3), amount: 500 },
          { account: id("Main"), date: day(2), amount: 200 },
        ],
      });
      assert.equal(await api.getAccountBalance(id("Main")), 1_500);
      assert.equal(await api.getAccountBalance(id("Main"), new Date(`${day(5)}T12:00:00`)), 1_700);
      assert.equal(await api.getAccountBalance("no-such-account"), 0);
    });

    it("importTransactions returns the added ids and creates title-cased payees", async () => {
      const { api, id } = await backend.budget({ accounts: [{ name: "Main" }], payees: ["Cafe"] });
      const result = await api.importTransactions(id("Main"), [
        { date: day(-20), amount: -100, payee_name: "compra zara" },
        { date: day(-10), amount: -200, payee_name: "CAFE" },
      ]);
      const stored = await api.getTransactions(id("Main"));
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.updated, []);
      assert.deepEqual(result.added.toSorted(), stored.map((t) => t.id).toSorted());

      const { payees, transactions } = await view(api);
      assert.deepEqual(payees, ["Cafe", "Compra Zara"]);
      assert.deepEqual(await transactions(id("Main")), [
        { date: day(-20), amount: -100, payee: "Compra Zara" },
        { date: day(-10), amount: -200, payee: "Cafe" },
      ]);
    });

    it("importTransactions keeps the name as written with original normalization", async () => {
      const { api, id } = await backend.budget({ accounts: [{ name: "Main" }] });
      await api.importTransactions(id("Main"), [{ date: today, amount: 1, payee_name: "ETF x" }], {
        payeeNameNormalization: "original",
      });
      assert.deepEqual((await view(api)).payees, ["ETF x"]);
    });

    it("importTransactions merges into a same-amount transaction unless forced", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Main" }],
        payees: ["Shop"],
        transactions: (id) => [
          { account: id("Main"), date: day(-5), amount: 2_345, payee: id("Shop") },
        ],
      });
      const fuzzy = await api.importTransactions(id("Main"), [
        { date: today, amount: 2_345, payee_name: "Broker" },
      ]);
      assert.deepEqual([fuzzy.added.length, fuzzy.updated.length], [0, 1]);

      const forced = await api.importTransactions(id("Main"), [
        { date: today, amount: 2_345, payee_name: "Broker", forceAddTransaction: true },
      ]);
      assert.equal(forced.added.length, 1);
      assert.deepEqual(await (await view(api)).transactions(id("Main")), [
        { date: day(-5), amount: 2_345, payee: "Shop" },
        { date: today, amount: 2_345, payee: "Broker" },
      ]);
    });

    it("importTransactions reports a bad amount, throws without a date, and previews", async () => {
      const { api, id } = await backend.budget({ accounts: [{ name: "Main" }] });
      const bad = await api.importTransactions(id("Main"), [{ date: today, amount: 1.5 }]);
      assert.deepEqual(bad.errors, [{ message: "Amount is invalid, must be an integer: 1.5" }]);
      assert.deepEqual(bad.added, []);
      await assert.rejects(api.importTransactions(id("Main"), [{ amount: 1 }]), /date/);

      const preview = await api.importTransactions(
        id("Main"),
        [{ date: today, amount: 1, payee_name: "New" }],
        { dryRun: true },
      );
      assert.equal(preview.added.length, 1);
      assert.deepEqual(await api.getTransactions(id("Main")), []);
      assert.deepEqual((await view(api)).payees, []);
    });

    it("createRule and updateRule reject operators a field doesn't support", async () => {
      const { api, id } = await backend.budget({ payees: ["Cafe"], categories: ["Coffee"] });
      const actions = [{ field: "category", op: "set", value: id("Coffee") }];
      for (const condition of [
        { field: "amount", op: "oneOf", value: [-999, -1_299] },
        { field: "notes", op: "oneOf", value: ["gym"] },
        { field: "date", op: "contains", value: "2026" },
        { field: "description", op: "is", value: id("Cafe") },
        { field: "imported_description", op: "is", value: "cafe" },
      ]) {
        await assert.rejects(api.createRule(rule([condition], actions)), {
          type: "APIError",
          message: "Failed creating a new rule",
        });
      }
      const created = await api.createRule(
        rule([{ field: "payee", op: "is", value: id("Cafe") }], actions),
      );
      await assert.rejects(
        api.updateRule({
          ...created,
          conditions: [{ field: "amount", op: "oneOf", value: [1, 2] }],
        }),
        { type: "APIError", message: "Failed updating the rule" },
      );
      assert.deepEqual((await view(api)).rules, [
        rule(
          [{ field: "payee", op: "is", value: "Cafe", type: "id" }],
          [{ field: "category", op: "set", value: "Coffee", type: "id" }],
        ),
      ]);
      assert.equal(await api.deleteRule(created.id), true);
      assert.deepEqual(await api.getRules(), []);
    });

    it("mergeRules folds same-action rules into ones Actual accepts", async () => {
      const { api } = await backend.budget({
        payees: ["Cafe", "Bar", "Zara"],
        categories: ["Coffee"],
        rules: (id) => {
          const coffee = [{ field: "category", op: "set", value: id("Coffee") }];
          const gym = [{ field: "notes", op: "set", value: "gym" }];
          const zara = [{ field: "payee", op: "set", value: id("Zara") }];
          return [
            rule([{ field: "payee", op: "is", value: id("Cafe") }], coffee),
            rule([{ field: "payee", op: "is", value: id("Bar") }], coffee),
            rule([{ field: "amount", op: "is", value: -999 }], gym),
            rule([{ field: "amount", op: "is", value: -1_299 }], gym),
            rule([{ field: "imported_payee", op: "contains", value: "ZARA" }], zara, {
              stage: "pre",
            }),
            rule([{ field: "imported_payee", op: "is", value: "Zara Porto" }], zara, {
              stage: "pre",
            }),
          ];
        },
      });
      assert.deepEqual(await mergeRules(api), []);

      const gym = [{ field: "notes", op: "set", value: "gym", type: "string" }];
      const zara = [{ field: "payee", op: "set", value: "Zara", type: "id" }];
      assert.deepEqual(
        (await view(api)).rules,
        [
          rule(
            [{ field: "payee", op: "oneOf", value: ["Bar", "Cafe"], type: "id" }],
            [{ field: "category", op: "set", value: "Coffee", type: "id" }],
          ),
          rule([{ field: "amount", op: "is", value: -999, type: "number" }], gym),
          rule([{ field: "amount", op: "is", value: -1_299, type: "number" }], gym),
          rule(
            [
              { field: "imported_payee", op: "is", value: "Zara Porto", type: "string" },
              { field: "imported_payee", op: "contains", value: "ZARA", type: "string" },
            ],
            zara,
            { stage: "pre", conditionsOp: "or" },
          ),
        ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      );
    });

    it("fixPayees merges renamed payees and leaves transfer payees named after accounts", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Visa 1234" }],
        payees: ["Cafe", "Compra 1234 Cafe"],
        transactions: (id) => [
          { account: id("Visa 1234"), date: day(-2), amount: -100, payee: id("Cafe") },
          { account: id("Visa 1234"), date: day(-1), amount: -200, payee: id("Compra 1234 Cafe") },
        ],
      });
      await fixPayees(api, { regex: "compra|[0-9]{4}" });

      const { payees, transferPayees, transactions } = await view(api);
      assert.deepEqual(payees, ["Cafe"]);
      assert.deepEqual(transferPayees, ["Visa 1234"]);
      assert.deepEqual(
        (await transactions(id("Visa 1234"))).map((t) => t.payee),
        ["Cafe", "Cafe"],
      );
    });

    it("syncBalances adds one adjustment, even next to a same-amount transaction", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Broker", balance: 7_655 }],
        payees: ["Shop"],
        transactions: (id) => [
          { account: id("Broker"), date: day(-1), amount: 2_345, payee: id("Shop") },
        ],
      });
      const accounts = [{ remoteAccount: "w1", actualAccount: id("Broker"), payeeName: "etf adj" }];
      const remote = new Map([["w1", 123.45]]);
      await syncBalances(api, "Test", accounts, remote);
      await syncBalances(api, "Test", accounts, remote);

      assert.equal(await api.getAccountBalance(id("Broker")), 12_345);
      assert.deepEqual(await (await view(api)).transactions(id("Broker")), [
        { date: day(-1), amount: 2_345, payee: "Shop" },
        { date: today, amount: 2_345, payee: "etf adj" },
      ]);
    });

    it("syncBalances fails for a closed or unknown account", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Open" }, { name: "Closed", closed: true }],
      });
      const sync = (actualAccount) =>
        syncBalances(
          api,
          "Test",
          [{ remoteAccount: "w1", actualAccount, payeeName: "Adj" }],
          new Map([["w1", 1]]),
        );
      await assert.rejects(sync(id("Closed")), /not an open account/);
      await assert.rejects(sync("no-such-account"), /not an open account/);
      await sync(id("Open"));
      assert.equal(await api.getAccountBalance(id("Open")), 100);
    });

    it("calculateMortgage records the principal once, for a payment in the last month", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Main" }, { name: "Loan", balance: -12_000_000 }],
        payees: ["House Loan"],
        transactions: (id) => [
          { account: id("Main"), date: day(-40), amount: -80_000, payee: id("House Loan") },
          { account: id("Main"), date: today, amount: -80_000, payee: id("House Loan") },
        ],
      });
      const mortgage = {
        payeeId: id("House Loan"),
        payeeName: "House Loan",
        mortgageAccountId: id("Loan"),
        mainAccountId: id("Main"),
        interestRate: 5399,
      };
      await calculateMortgage(api, mortgage);
      await calculateMortgage(api, mortgage);
      assert.deepEqual(await (await view(api)).transactions(id("Loan")), [
        { date: today, amount: 26_010, payee: "House Loan" },
      ]);
    });

    it("calculateMortgage doesn't merge the principal into a same-amount transaction", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Main" }, { name: "Loan", balance: -12_026_010 }],
        payees: ["House Loan", "Bank"],
        transactions: (id) => [
          { account: id("Main"), date: today, amount: -80_000, payee: id("House Loan") },
          // Brings the balance to -120,000.00, so the principal is 260.10 too.
          { account: id("Loan"), date: day(-3), amount: 26_010, payee: id("Bank") },
        ],
      });
      const mortgage = {
        payeeId: id("House Loan"),
        payeeName: "House Loan",
        mortgageAccountId: id("Loan"),
        mainAccountId: id("Main"),
        interestRate: 5399,
      };
      await calculateMortgage(api, mortgage);
      await calculateMortgage(api, mortgage);
      assert.deepEqual(await (await view(api)).transactions(id("Loan")), [
        { date: day(-3), amount: 26_010, payee: "Bank" },
        { date: today, amount: 26_010, payee: "House Loan" },
      ]);
      const [bank] = (await api.getTransactions(id("Loan"))).filter((t) => t.date === day(-3));
      assert.equal(bank.imported_payee ?? null, null);
    });

    it("calculateMortgage ignores payments older than a month", async () => {
      const { api, id } = await backend.budget({
        accounts: [{ name: "Main" }, { name: "Loan", balance: -12_000_000 }],
        payees: ["House Loan"],
        transactions: (id) => [
          { account: id("Main"), date: day(-40), amount: -80_000, payee: id("House Loan") },
        ],
      });
      await calculateMortgage(api, {
        payeeId: id("House Loan"),
        payeeName: "House Loan",
        mortgageAccountId: id("Loan"),
        mainAccountId: id("Main"),
        interestRate: 5399,
      });
      assert.deepEqual(await (await view(api)).transactions(id("Loan")), []);
    });
  });
}
