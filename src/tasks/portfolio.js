import { formatDate, importTransactions } from "../actual.js";
import { requestJson } from "../http.js";
import { log } from "../log.js";

export async function fetchGhostfolioBalances({ serverURL, token }) {
  const json = await requestJson(`${serverURL}/api/v1/account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return new Map(json.accounts.map((account) => [account.id, account.value]));
}

export async function fetchWealthfolioBalances({ serverURL }) {
  // Refresh valuations first; a failure here still lets us use the last known values.
  await requestJson(`${serverURL}/api/v1/portfolio/update`, { method: "POST" }).catch((err) =>
    log.warn("Wealthfolio portfolio update failed:", err.message),
  );
  const valuations = await requestJson(`${serverURL}/api/v1/valuations/latest`);
  return new Map(valuations.map((valuation) => [valuation.accountId, valuation.totalValue]));
}

/**
 * Makes each Actual account match its remote balance by adding one adjustment transaction for the
 * difference on every sync that finds one.
 */
export async function syncBalances(api, name, accounts, remoteBalances) {
  const today = formatDate();

  for (const { remoteAccount, actualAccount, payeeName } of accounts) {
    if (!remoteBalances.has(remoteAccount)) {
      log.error(`${name} account ${remoteAccount} not found`);
      continue;
    }
    const remoteBalance = Math.round(remoteBalances.get(remoteAccount) * 100);
    const difference = remoteBalance - (await api.getAccountBalance(actualAccount));

    if (difference === 0) {
      log.info(`No difference for ${payeeName} (${remoteBalance / 100})`);
      continue;
    }

    // Forced, so Actual doesn't merge it into another transaction with the same amount, and with
    // the payee name kept as written instead of title-cased.
    await importTransactions(
      api,
      actualAccount,
      [{ date: today, amount: difference, payee_name: payeeName, forceAddTransaction: true }],
      { payeeNameNormalization: "original" },
    );
  }
}
