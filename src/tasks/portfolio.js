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
 * Makes each Actual account match its remote balance using one adjustment transaction per day:
 * the first sync of a day adds it, later syncs that day update its amount. The adjustment is
 * today's unreconciled transaction with the account's payee.
 */
export async function syncBalances(api, name, accounts, remoteBalances) {
  const today = formatDate();
  const payeeIds = new Map((await api.getPayees()).map((payee) => [payee.name, payee.id]));

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

    const transactions = await api.getTransactions(actualAccount, today, today);
    const payeeId = payeeIds.get(payeeName);
    const adjustment = transactions.find((t) => payeeId && t.payee === payeeId && !t.reconciled);
    if (adjustment) {
      log.info(`Updating ${payeeName} adjustment by ${difference / 100}`);
      await api.updateTransaction(adjustment.id, { amount: adjustment.amount + difference });
    } else {
      await importTransactions(api, actualAccount, [
        { date: today, amount: difference, payee_name: payeeName },
      ]);
    }
  }
}
