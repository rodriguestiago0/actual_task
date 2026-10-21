import { formatDate, importTransactions } from "../actual.js";
import { requestJson } from "../http.js";

export async function fetchGhostfolioBalances({ serverURL, token }) {
  const json = await requestJson(`${serverURL}/api/v1/account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return new Map(json.accounts.map((account) => [account.id, account.value]));
}

export async function fetchWealthfolioBalances({ serverURL }) {
  // Refresh valuations first; a failure here still lets us use the last known values.
  await requestJson(`${serverURL}/api/v1/portfolio/update`, { method: "POST" }).catch((err) =>
    console.warn("Wealthfolio portfolio update failed:", err.message),
  );
  const valuations = await requestJson(`${serverURL}/api/v1/valuations/latest`);
  return new Map(valuations.map((valuation) => [valuation.accountId, valuation.totalValue]));
}

/** Adds a balance adjustment to each Actual account so it matches the remote balance. */
export async function syncBalances(api, name, accounts, remoteBalances) {
  for (const { remoteAccount, actualAccount, payeeName } of accounts) {
    if (!remoteBalances.has(remoteAccount)) {
      console.error(`${name} account ${remoteAccount} not found`);
      continue;
    }
    const remoteBalance = Math.round(remoteBalances.get(remoteAccount) * 100);
    const actualBalance = await api.getAccountBalance(actualAccount);

    if (remoteBalance === actualBalance) {
      console.info(`No difference for ${payeeName} (${actualBalance / 100})`);
      continue;
    }
    await importTransactions(actualAccount, [
      { date: formatDate(), amount: remoteBalance - actualBalance, payee_name: payeeName },
    ]);
  }
}
