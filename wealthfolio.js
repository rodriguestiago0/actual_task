const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();


async function getAccountsBalance() {
    url = appConfig.WEALTHFOLIO_SERVER_URL+ '/api/v1/valuations/latest'
    accounts = await fetch(url, {
        method: 'GET',
    })
    .then((response) => response.json())
    .catch((err) => {
        console.error("error occured", err);
    });

    return accounts;
}

module.exports = {
    getAccountsBalance
}
