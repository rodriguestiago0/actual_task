const { getAppConfigFromEnv, getConf } = require("./config");
const { initialize, getPayees, getAllPayees, updatePayees, getLastTransaction, finalize, getAccountBalance, importTransactions, mergePayees} = require("./actual.js");
const ghostfolio = require("./ghostfolio.js");

const appConfig = getAppConfigFromEnv();
config = getConf("default")

async function fixPayees() {
    let actual = await initialize(config);
    payees = await getPayees(actual, appConfig.PAYEE_REGEX_MATCH)
    updatedPayee = {}
    payees.forEach(payee => {
        let name = payee.name;
        if (appConfig.PAYEE_REGEX_MATCH != "")
        {
            name = payee.name.replace(new RegExp(appConfig.PAYEE_REGEX_MATCH, "gis"), "");
        }
        name = name.replace(new RegExp(" {2,}", "gis"), " ").trim()
        if (name != payee.name)
        {
            updatedPayee[payee.id] = name;
            console.log ("Update payee from " + payee.name + " to " + name)
        }
    });
    
    
    await finalize(actual);
    
    actual = await initialize(config);

    await updatePayees(actual, updatedPayee)

    const payeesToMerge = new Map();
    allPayees = await getAllPayees(actual)
    allPayees.forEach(payee => {
        if (payee.transfer_acct != null) {
            return;
        }
        let ids = [];
        if (payeesToMerge.has(payee.name)){
            ids = payeesToMerge.get(payee.name);
            ids.push(payee.id);
        } else {
            ids.push(payee.id);
        }
        payeesToMerge.set(payee.name, ids);
    })

    for (let [name, ids] of payeesToMerge) { 
        if (ids.length > 1) {
            console.log("Merge payees", name, ids);
            await mergePayees(actual, ids);
        }       
    }

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

async function calculateMortgage() {
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
    const ghostfolioAccounts = await ghostfolio.getAccountsBalance();
    for (const [ghostfolioAccount, actualAccount] of Object.entries(appConfig.GHOSTFOLIO_ACCOUNT_MAPPING)) {
        actualBalance = await getAccountBalance(actual, actualAccount);
        ghostfolioAccountDetails = ghostfolioAccounts.filter((account) => account.id == ghostfolioAccount);
        ghostfolioBalance = Math.floor(ghostfolioAccountDetails[0].value*100);
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
            console.log("No difference found for account " + account + '(' + actualBalance + ')' + '(' + actualBalance + ')');
        }
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
    calculateMortgage,
    ghostfolioSync,
    bankSync
}
