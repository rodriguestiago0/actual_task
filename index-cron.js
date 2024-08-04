const { fixPayees, calculateMortage, ghostfolioSync } = require("./engine.js");
var cron = require('node-cron');
const parser = require('cron-parser');
const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();

var cronExpression = "0 */4 * * *";
if (appConfig.CRON_EXPRESSION != "") {
    cronExpression = appConfig.CRON_EXPRESSION
}
console.info("Defined cron is: ", cronExpression)
const interval = parser.parseExpression(cronExpression);
console.info('Next run:', interval.next().toISOString());

cron.schedule(cronExpression, async () => {
    if (appConfig.ENABLE_INTEREST_CALCULATION) {
        await calculateMortage();
    }

    if (appConfig.ENABLE_PAYEE_RENAME) {
        await fixPayees();
    }

    if (appConfig.ENABLE_GHSOTFOLIO_SYNC) {
        await ghostfolioSync();
    }
    console.info('Next run:', interval.next().toISOString());
});

