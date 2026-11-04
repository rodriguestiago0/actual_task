import { log } from "../log.js";

/**
 * Runs Actual's bank sync for every linked account and logs what it found. When accounts fail,
 * Actual reports only the first error.
 */
export async function bankSync(api) {
  const result = await api.runBankSync();
  // undefined in a dry run, where the sync is skipped
  if (!result) return;
  const { newTransactions = [], matchedTransactions = [], updatedAccounts = [] } = result;
  log.info(
    `Bank sync: ${newTransactions.length} new and ${matchedTransactions.length} matched ` +
      `transactions, ${updatedAccounts.length} accounts updated`,
  );
}
