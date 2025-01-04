const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();


async function getAccountBalance(accountId) {
    token = 'Bearer ' + appConfig.GHOSTFOLIO_TOKEN
    url = appConfig.GHOSTFOLIO_SERVER_URL+ '/api/v1/account'
    accounts = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': token
        },
    })
    .then((response) => response.json())
    .then((json) => json.accounts)
    .catch((err) => {
        console.error("error occured", err);
    });
    account = accounts.filter((account) => account.id == accountId);

    return Math.floor(account[0].value*100);
}

module.exports = {
    getAccountBalance
}
