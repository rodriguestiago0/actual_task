import { formatDate, importTransactions, requireOpenAccounts } from "../actual.js";
import { requestJson } from "../http.js";
import { log } from "../log.js";

/** Exchanges the Ghostfolio security token for a JWT (valid for 180 days). */
async function ghostfolioAuthToken({ serverURL, accessToken, token }) {
  if (!accessToken) {
    log.warn("GHOSTFOLIO_TOKEN expires after 180 days; set GHOSTFOLIO_ACCESS_TOKEN instead");
    return token;
  }
  const { authToken } = await requestJson(`${serverURL}/api/v1/auth/anonymous`, {
    method: "POST",
    body: { accessToken },
  });
  return authToken;
}

/** Returns each account's balance in the account's own currency, not the user's base currency. */
export async function fetchGhostfolioBalances(ghostfolio) {
  const token = await ghostfolioAuthToken(ghostfolio);
  const get = (path) =>
    requestJson(`${ghostfolio.serverURL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  // /api/v1/accounts replaced /api/v1/account in Ghostfolio 3.94.0; older servers only have the
  // deprecated one.
  const json = await get("/api/v1/accounts").catch((err) => {
    if (err.status !== 404) throw err;
    return get("/api/v1/account");
  });
  if (json.accounts.some((account) => account.value == null)) {
    log.warn("Ghostfolio hid account values; turn off Restricted view for the synced user");
  }
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
 * difference on every sync that finds one. Returns a warning for each remote account not found.
 */
export async function syncBalances(api, name, accounts, remoteBalances) {
  await requireOpenAccounts(
    api,
    name,
    accounts.map(({ remoteAccount, actualAccount }) => [
      `for ${name} account ${remoteAccount}`,
      actualAccount,
    ]),
    `Check the ${name.toUpperCase()}_ACTUAL_ACCOUNT variables`,
  );
  const today = formatDate();
  const warnings = [];

  for (const { remoteAccount, actualAccount, payeeName } of accounts) {
    const balance = remoteBalances.get(remoteAccount);
    if (!Number.isFinite(balance)) {
      // A missing or hidden (null) balance would otherwise sync the account to 0.
      const warning = remoteBalances.has(remoteAccount)
        ? `${name} returned no balance for account ${remoteAccount}`
        : `${name} account ${remoteAccount} not found`;
      log.warn(warning);
      warnings.push(warning);
      continue;
    }
    const remoteBalance = Math.round(balance * 100);
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
  return warnings;
}
