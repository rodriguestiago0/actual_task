import { formatDate } from "../src/actual.js";

// Field types and the operators Actual accepts on them (TYPE_INFO, FIELD_INFO in @actual-app/api),
// under their API names: Actual rejects rules on the stored names (description, ...).
const TYPE_OPS = {
  date: ["is", "isapprox", "gt", "gte", "lt", "lte"],
  id: ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf"],
  string: [
    ...["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf"],
    ...["hasTags", "hasAnyTag"],
  ],
  number: ["is", "isapprox", "isbetween", "gt", "gte", "lt", "lte"],
  boolean: ["is"],
};
const FIELDS = {
  imported_payee: { type: "string", disallowed: ["hasTags", "hasAnyTag"] },
  payee: { type: "id" },
  payee_name: { type: "string" },
  date: { type: "date" },
  notes: { type: "string", disallowed: ["oneOf", "notOneOf"] },
  amount: { type: "number" },
  category: { type: "id", internal: ["and"] },
  category_group: { type: "id", internal: ["and"] },
  account: { type: "id", extra: ["onBudget", "offBudget"] },
  cleared: { type: "boolean" },
  reconciled: { type: "boolean" },
  transfer: { type: "boolean" },
  parent: { type: "boolean" },
};

function validCondition({ field, op, value }) {
  const info = FIELDS[field];
  if (!info || info.disallowed?.includes(op)) return false;
  const ops = [...TYPE_OPS[info.type], ...(info.extra ?? []), ...(info.internal ?? [])];
  return ops.includes(op) && (!["oneOf", "notOneOf"].includes(op) || Array.isArray(value));
}

const validAction = ({ field, op }) => op !== "set" || Object.hasOwn(FIELDS, field);

/** The rule with each part's type filled in, as getRules returns it. */
const typed = (rule) => {
  const withType = (part) =>
    part.type || !FIELDS[part.field] ? part : { ...part, type: FIELDS[part.field].type };
  return {
    ...rule,
    conditions: rule.conditions.map(withType),
    actions: rule.actions.map(withType),
  };
};

/** Actual's title case for imported payee names, except that it keeps "of", "the"... lowercase. */
const titleCase = (name) =>
  name.toLowerCase().replace(/(^|\s)(\S)/g, (_, s, c) => s + c.toUpperCase());

const addDays = (date, days) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return formatDate(d);
};

/**
 * In-memory stand-in for @actual-app/api, recording every call. It keeps the budget's state and
 * follows the real API where the tasks depend on it (checked by test/contract.test.js): date
 * ranges, balances up to a cutoff, rule validation, payee merges, and imports that resolve and
 * create payees, fuzzy-match an existing transaction and report errors. It doesn't run rules on
 * imports or sync: the real shutdown() syncs too, swallowing errors.
 *
 * transactions maps an account id to its transactions; balances maps an account id to its balance
 * before them (the real API records that as a starting balance transaction).
 */
export function fakeApi({
  transactions = {},
  balances = {},
  payees: givenPayees = [],
  rules: givenRules = [],
  accounts = [],
  categories = [],
} = {}) {
  const payees = [...givenPayees];
  const rules = [...givenRules];
  const calls = [];
  const record =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return typeof result === "function" ? result(...args) : result;
    };

  let nextId = 1;
  const newId = (prefix) => `${prefix}-${nextId++}`;
  let stored = Object.entries(transactions).flatMap(([account, list]) =>
    list.map((t) => ({ id: newId("tx"), ...t, account })),
  );
  payees.push(
    ...accounts
      .filter((account) => account.name && !payees.some((p) => p.transfer_acct === account.id))
      .map((account) => ({
        id: `transfer-${account.id}`,
        name: account.name,
        transfer_acct: account.id,
      })),
  );

  function importTransactions(accountId, list, opts = {}) {
    const normalize = opts.payeeNameNormalization === "original" ? (n) => n : titleCase;
    const created = [];
    const payeeFor = (name) => {
      const lower = name.toLowerCase();
      const found = [...payees, ...created].find((p) => p.name.toLowerCase() === lower);
      if (found) return found.id;
      const payee = { id: newId("payee"), name, transfer_acct: null };
      created.push(payee);
      return payee.id;
    };
    const result = { errors: [], added: [], updated: [], updatedPreview: [] };
    const changes = [];
    const matched = new Set();
    for (const { payee_name, forceAddTransaction, ...trans } of list) {
      if (trans.date == null) throw new Error("`date` is required when adding a transaction");
      if (trans.amount != null && !Number.isInteger(trans.amount)) {
        const message = `Amount is invalid, must be an integer: ${trans.amount}`;
        return { errors: [{ message }], added: [], updated: [], updatedPreview: [] };
      }
      const name = payee_name?.trim() ? normalize(payee_name.trim()) : null;
      const t = {
        ...trans,
        account: accountId,
        payee: trans.payee ?? (name ? payeeFor(name) : null),
        imported_payee: trans.imported_payee || name,
        category: trans.category ?? null,
      };
      // Actual's fuzzy match: same account and amount within 7 days, the same payee first.
      const [from, to] = [addDays(t.date, -7), addDays(t.date, 7)];
      const candidates = stored.filter(
        (s) =>
          s.account === accountId &&
          s.amount === (t.amount ?? 0) &&
          s.date >= from &&
          s.date <= to &&
          !matched.has(s.id),
      );
      const match = candidates.find((s) => s.payee === t.payee) ?? candidates[0];
      if (match && !forceAddTransaction) {
        matched.add(match.id);
        if (match.reconciled) continue;
        if (t.imported_payee && t.imported_payee !== match.imported_payee) {
          result.updated.push(match.id);
          changes.push(() => Object.assign(match, { imported_payee: t.imported_payee }));
        }
        continue;
      }
      const id = newId("tx");
      result.added.push(id);
      changes.push(() => stored.push({ id, ...t }));
    }
    if (!opts.dryRun) {
      for (const change of changes) change();
      // only the payees of added transactions, as in Actual
      const used = new Set(stored.map((t) => t.payee));
      payees.push(...created.filter((payee) => used.has(payee.id)));
    }
    return result;
  }

  function saveRule(rule, message) {
    if (!rule.conditions.every(validCondition) || !rule.actions.every(validAction)) {
      // like Actual's APIError, not an Error
      throw { type: "APIError", message };
    }
    return typed(rule);
  }

  return {
    calls,
    init: record("init"),
    downloadBudget: record("downloadBudget"),
    sync: record("sync"),
    shutdown: record("shutdown"),
    getTransactions: record("getTransactions", (accountId, startDate, endDate) =>
      stored.filter(
        (t) =>
          (!accountId || t.account === accountId) &&
          (!startDate || t.date >= startDate) &&
          (!endDate || t.date <= endDate),
      ),
    ),
    getAccountBalance: record("getAccountBalance", (accountId, cutoff = new Date()) => {
      const day = formatDate(cutoff);
      return stored
        .filter((t) => t.account === accountId && t.date <= day)
        .reduce((sum, t) => sum + t.amount, balances[accountId] ?? 0);
    }),
    importTransactions: record("importTransactions", importTransactions),
    updateTransaction: record("updateTransaction", (id, fields) => {
      Object.assign(stored.find((t) => t.id === id) ?? {}, fields);
    }),
    deleteTransaction: record("deleteTransaction", (id) => {
      stored = stored.filter((t) => t.id !== id);
    }),
    getPayees: record("getPayees", () => payees.map((payee) => ({ ...payee }))),
    updatePayee: record("updatePayee", (id, fields) => {
      const payee = payees.find((p) => p.id === id);
      // a transfer payee is named after its account, and keeps that name
      Object.assign(payee, fields, payee.transfer_acct && { name: payee.name });
      return id;
    }),
    mergePayees: record("mergePayees", (targetId, mergeIds) => {
      for (const t of stored) if (mergeIds.includes(t.payee)) t.payee = targetId;
      payees.splice(0, payees.length, ...payees.filter((p) => !mergeIds.includes(p.id)));
    }),
    getCategories: record("getCategories", () => categories),
    getAccounts: record("getAccounts", () => accounts),
    getRules: record("getRules", () => [...rules]),
    createRule: record("createRule", (rule) => {
      const saved = saveRule({ ...rule, id: newId("rule") }, "Failed creating a new rule");
      rules.push(saved);
      return saved;
    }),
    updateRule: record("updateRule", (rule) => {
      const saved = saveRule(rule, "Failed updating the rule");
      const index = rules.findIndex((r) => r.id === rule.id);
      if (index !== -1) rules[index] = saved;
      return saved;
    }),
    deleteRule: record("deleteRule", (id) => {
      // Actual keeps a rule a schedule uses
      const rule = rules.find((r) => r.id === id);
      if (rule?.actions.some((action) => action.op === "link-schedule")) return false;
      rules.splice(0, rules.length, ...rules.filter((r) => r.id !== id));
      return true;
    }),
  };
}

export const callsTo = (api, name) => api.calls.filter(([call]) => call === name);
