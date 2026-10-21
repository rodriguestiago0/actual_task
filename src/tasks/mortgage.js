import { formatDate, getLastTransaction, importTransactions } from "../actual.js";

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
  const lastPayment = await getLastTransaction(mainAccountId, payeeId);
  if (!lastPayment) {
    console.info("No mortgage payment in the last month, skipping");
    return;
  }

  const lastPrincipal = await getLastTransaction(mortgageAccountId, payeeId);
  if (lastPrincipal && lastPrincipal.date.slice(0, 7) === lastPayment.date.slice(0, 7)) {
    console.info("Principal already recorded for this payment");
    return;
  }

  const balance = await api.getAccountBalance(mortgageAccountId);
  const amount = principalAmount(balance, lastPayment.amount, interestRate);
  console.info(`Recording principal of ${amount / 100} for payment on ${lastPayment.date}`);
  await importTransactions(mortgageAccountId, [
    { date: formatDate(), amount, payee_name: payeeName },
  ]);
}
