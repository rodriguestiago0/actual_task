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
  if (!Array.isArray(json?.accounts)) throw new Error("Ghostfolio returned no account list");
  if (json.accounts.some((account) => account.value == null)) {
    log.warn("Ghostfolio hid account values; turn off Restricted view for the synced user");
  }
  return new Map(json.accounts.map((account) => [account.id, account.value]));
}

/**
 * Returns each account's latest valuation, and a warning when refreshing the valuations failed: the
 * last known values are used then.
 */
export async function fetchWealthfolioBalances({ serverURL }) {
  const warnings = [];
  await requestJson(`${serverURL}/api/v1/portfolio/update`, { method: "POST" }).catch((err) => {
    const warning = `Wealthfolio portfolio update failed, using the last valuations: ${err.message}`;
    log.warn(warning);
    warnings.push(warning);
  });
  const valuations = await requestJson(`${serverURL}/api/v1/valuations/latest`);
  if (!Array.isArray(valuations)) throw new Error("Wealthfolio returned no valuation list");
  const balances = new Map(
    valuations.map((valuation) => [valuation.accountId, valuation.totalValue]),
  );
  return { balances, warnings };
}

/**
 * Makes each Actual account match its remote balance by adding one adjustment transaction for the
 * difference on every sync that finds one. Returns a warning for each remote account not found or
 * without a balance, and for each one skipped because its balance dropped to exactly 0: Ghostfolio
 * reports 0 for an account it has no valuation for. allowZero syncs those too.
 */
export async function syncBalances(
  api,
  name,
  accounts,
  remoteBalances,
  { allowZero = false } = {},
) {
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
    const actualBalance = await api.getAccountBalance(actualAccount);
    const difference = remoteBalance - actualBalance;

    if (remoteBalance === 0 && actualBalance !== 0 && !allowZero) {
      const warning =
        `${name} account ${remoteAccount} has a balance of 0, not syncing it ` +
        `(${actualBalance / 100} in Actual). Set ${name.toUpperCase()}_ALLOW_ZERO_BALANCE=true ` +
        "if it really is empty";
      log.warn(warning);
      warnings.push(warning);
      continue;
    }

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
