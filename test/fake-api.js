/** Minimal in-memory stand-in for @actual-app/api, recording every call. */
export function fakeApi({ transactions = {}, balances = {}, payees = [] } = {}) {
  const calls = [];
  const record =
    (name, result) =>
    async (...args) => {
      calls.push([name, ...args]);
      return typeof result === "function" ? result(...args) : result;
    };

  return {
    calls,
    init: record("init"),
    downloadBudget: record("downloadBudget"),
    sync: record("sync"),
    shutdown: record("shutdown"),
    getTransactions: record("getTransactions", (accountId) => transactions[accountId] ?? []),
    getAccountBalance: record("getAccountBalance", (accountId) => balances[accountId] ?? 0),
    importTransactions: record("importTransactions", (_, txs) => ({ added: txs, updated: [] })),
    updateTransaction: record("updateTransaction"),
    deleteTransaction: record("deleteTransaction"),
    getPayees: record("getPayees", () => payees),
    updatePayee: record("updatePayee", (id, fields) => {
      Object.assign(
        payees.find((payee) => payee.id === id),
        fields,
      );
    }),
    mergePayees: record("mergePayees"),
  };
}

export const callsTo = (api, name) => api.calls.filter(([call]) => call === name);
