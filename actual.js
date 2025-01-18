const { getAppConfigFromEnv } = require("./config");
const actual = require("@actual-app/api");
const fs = require("fs");
let { q } = require('@actual-app/api');


const appConfig = getAppConfigFromEnv();

/**
 * 
 * @returns {Promise<typeof actual>}
 */
async function initialize(config) {
    try {
        const tmp_dir = `./temp_data_actual/${config.get("user")}`
        fs.mkdirSync(tmp_dir, { recursive: true });
        await actual.init({
            serverURL: appConfig.ACTUAL_SERVER_URL,
            password: appConfig.ACTUAL_SERVER_PASSWORD,
            dataDir: tmp_dir
        });

        let id = config.get("budget_id")
        var passwordConfig = {};
        if (appConfig.ACTUAL_FILE_PASSWORD) {
            passwordConfig = {
                password: appConfig.ACTUAL_FILE_PASSWORD
            }
        }
        await actual.downloadBudget(id, passwordConfig);
    } catch (e) {
        throw new Error(`Actual Budget Error: ${e.message}`);
    }

    return actual;
}

/**
 * 
 * @param {typeof actual} actualInstance 
 */
function listAccounts(actualInstance) {
    return actualInstance.getAccounts();
}

/**
 * 
 * @param {typeof actual} actualInstance 
 */
async function getPayees(actualInstance, regexExpressionToMatch) {
    if (regexExpressionToMatch == "") {
        return []
    }
    payees = await actualInstance.getPayees();
    toBeUpdated = []
    payees.forEach(payee => {
        if (payee.name.match(regexExpressionToMatch)) {
            toBeUpdated.push(payee)
        }
    });
    return toBeUpdated;
}

/**
 * 
 * @param {typeof actual} actualInstance 
 */
async function updatePayees(actualInstance, payeesToUpdate) {
    for (id of Object.keys(payeesToUpdate)) {
        await actualInstance.updatePayee(id, {
            "Name": payeesToUpdate[id]
          });
    } 
}

/**
 * @param {typeof actual} actualInstance 
 * @param {*} accountId 
 */
async function getLastTransaction(actualInstance, accountId, payeeID) {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() -1);

    const transactions = await actualInstance.getTransactions(accountId, monthAgo, new Date());
    filteredTransactions = transactions;

    if (payeeID != undefined && payeeID != null && payeeID != "") {
        filteredTransactions = filteredTransactions.filter(transaction => {
            return transaction.payee == payeeID
        })
    }

    if (filteredTransactions.length === 0) {
        return null;
    }

    return filteredTransactions[0];
}

/**
 * @param {typeof actual} actualInstance 
 * @param {*} accountId 
 * @param {*} transactions 
 */
async function importTransactions(actualInstance, accountId, transactions) {
    console.info("Importing transactions raw data START:")
    console.debug(transactions)
    const actualResult = await actualInstance.importTransactions(
        accountId,
        transactions
    );
    console.info("Actual logs: ", actualResult);
}

/**
 * @param {typeof actual} actualInstance 
 * @param {*} accountId 
 */
async function getAccountBalance(actualInstance, accountId) {
    const balance = await actualInstance.getAccountBalance(accountId)
    return balance;
}

/**
 * @param {typeof actual} actualInstance 
 * @param {*} month 
 */
async function getHoldBalance(actualInstance, month) {
    const budget = await actualInstance.getBudgetMonth(month)
    received = 0
    for (const [_, categoryGroup] of Object.entries(budget.categoryGroups)) {
        if(categoryGroup.is_income) {
            received += categoryGroup.received
        }
    }
    return received;
}



/**
 * @param {typeof actual} actualInstance 
 * @param {*} month 
 */
async function holdBudgetForNextMonth(actualInstance, month, amount) {
    await actualInstance.resetBudgetHold(month);
    actualInstance.holdBudgetForNextMonth(month, amount);
}
/**
 * 
 * @param {typeof actual} actualInstance 
 */
async function finalize(actualInstance) {
    await actualInstance.sync()
    await actualInstance.shutdown();
}

module.exports = {
    initialize,
    listAccounts,
    importTransactions,
    getAccountBalance,
    getPayees,
    updatePayees,
    getLastTransaction,
    getHoldBalance,
    holdBudgetForNextMonth,
    finalize
}
