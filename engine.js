const { getAppConfigFromEnv, getConf } = require("./config");
const { initialize, getPayees, updatePayees, getLastTransaction, finalize, getAccountBalance, importTransactions, getHoldBalance, holdBudgetForNextMonth} = require("./actual.js");
const ghostfolio = require("./ghostfolio.js");

const appConfig = getAppConfigFromEnv();
config = getConf("default")

async function fixPayees() {
    const actual = await initialize(config);
    payees = await getPayees(actual, appConfig.PAYEE_REGEX_MATCH)
    updatedPayee = {}
    payees.forEach(payee => {
        let name = payee.name;
        if (appConfig.PAYEE_REGEX_MATCH != "")
        {
            name = payee.name.replace(new RegExp(appConfig.PAYEE_REGEX_MATCH, "gis"), "");
        }
        name = name.replace(new RegExp(" {2,}", "gis"), " ")
        if (name != payee.name)
        {
            updatedPayee[payee.id] = name.trim();
            console.log ("Update payee from " + payee.name + " to " + name.trim() )
        }
    });
    await updatePayees(actual, updatedPayee)
    await finalize(actual);
}

function padTo2Digits(num) {
    return num.toString().padStart(2, '0');
}

function formatDate(date) {
    return [
      date.getFullYear(),
      padTo2Digits(date.getMonth() + 1),
      padTo2Digits(date.getDate()),
    ].join('-');
  }

async function calculateMortage() {
    const actual = await initialize(config);
    lastPaymentTransaction = await getLastTransaction(actual, appConfig.MAIN_ACCOUNT_ID, appConfig.MORTGAGE_PAYEE_ID);
    lastPrincipalTransaction = await getLastTransaction(actual, appConfig.MORTGAGE_ACCOUNT_ID, appConfig.MORTGAGE_PAYEE_ID);

    if (lastPrincipalTransaction == null || new Date(lastPaymentTransaction.date).getMonth() != new Date(lastPrincipalTransaction.date).getMonth())
    {
        balance = await getAccountBalance(actual, appConfig.MORTGAGE_ACCOUNT_ID);
        console.log(lastPaymentTransaction, lastPrincipalTransaction, balance)
        payment = Math.round(balance * appConfig.INTEREST_RATE / 12 / 100000 * -1);
        principal = (lastPaymentTransaction.amount + payment) * -1;
        await importTransactions(actual, appConfig.MORTGAGE_ACCOUNT_ID,[
            {
                date:   formatDate(new Date()),
                amount: principal,
                payee_name: appConfig.MORTGAGE_PAYEE_NAME,
            },
        ])
    }
    await finalize(actual);
}

async function ghostfolioSync() {
    const actual = await initialize(config);
    for (const [ghostfolioAccount, actualAccount] of Object.entries(appConfig.GHOSTFOLIO_ACCOUNT_MAPPING)) {
        actualBalance = await getAccountBalance(actual, actualAccount);
        ghostfolioBalance = await ghostfolio.getAccountBalance(ghostfolioAccount);
        account = appConfig.GHOSTFOLIO_ACTUAL_PAYEE_NAME_MAPPING[ghostfolioAccount];
        if (actualBalance != ghostfolioBalance) {
            await importTransactions(actual, actualAccount, [
                {
                    date:   formatDate(new Date()),
                    amount: ghostfolioBalance-actualBalance,
                    payee_name: account,
                }
            ])
        } else {
            console.log("No difference found for account " + account);
        }
    }
    await finalize(actual);
}

function zeroPad(num, places) {
    var zero = places - num.toString().length + 1;
    return Array(+(zero > 0 && zero)).join("0") + num;
  }

async function holdAmoutForNextMonth() {
    const date = new Date();
    const year = date.getFullYear();
    d = year + '-' + zeroPad(date.getMonth() + 1, 2)
    const actual = await initialize(config);
    amount = await getHoldBalance(actual, d);
    if (amount > 0) {
        await holdBudgetForNextMonth(actual, d, amount)
    }
    await finalize(actual);
}
async function bankSync() {
    const actual = await initialize(config);
    await actual.runBankSync()
    await finalize(actual);
}

module.exports = {
    fixPayees,
    calculateMortage,
    ghostfolioSync,
    holdAmoutForNextMonth,
    bankSync
}
