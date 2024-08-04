const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();


async function getAccountBalance(accountId) {
    token = 'Bearer ' + appConfig.GHOSTFOLIO_TOKEN
    url = appConfig.GHOSTFOLIO_SERVER_URL+ '/api/v1/account/' + accountId
    balance = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': token
        },
    })
        .then((response) => response.json())
        .then((json) => json.value)
        .catch((err) => {
            console.error("error occured", err);
        });

    return Math.floor(balance*100);
}

module.exports = {
    getAccountBalance
}
