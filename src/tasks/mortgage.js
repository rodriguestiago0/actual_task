import { formatDate, getLastTransaction, importTransactions } from "../actual.js";
import { log } from "../log.js";

/**
 * Principal part of a mortgage payment, in cents (positive reduces the debt).
 * balance is the (negative) mortgage balance and payment the (negative) monthly payment.
 */
export function principalAmount(balance, payment, interestRate) {
  const interest = Math.round((-balance * interestRate) / 12 / 100000);
  return -(payment + interest);
}

export async function calculateMortgage(
  api,
  { payeeId, payeeName, mortgageAccountId, mainAccountId, interestRate },
) {
  const lastPayment = await getLastTransaction(api, mainAccountId, payeeId);
  if (!lastPayment) {
    log.info("No mortgage payment in the last month, skipping");
    return;
  }

  const lastPrincipal = await getLastTransaction(api, mortgageAccountId, payeeId);
  // The principal is dated when it was recorded, which can be in the month after the payment.
  if (lastPrincipal && lastPrincipal.date >= lastPayment.date) {
    log.info("Principal already recorded for this payment");
    return;
  }

  const balance = await api.getAccountBalance(mortgageAccountId);
  const amount = principalAmount(balance, lastPayment.amount, interestRate);
  log.info(`Recording principal of ${amount / 100} for payment on ${lastPayment.date}`);
  await importTransactions(api, mortgageAccountId, [
    { date: formatDate(), amount, payee_name: payeeName },
  ]);
}
