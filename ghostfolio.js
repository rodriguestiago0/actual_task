const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();


async function getAccountsBalance() {
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

    return accounts;
}

module.exports = {
    getAccountsBalance
}
