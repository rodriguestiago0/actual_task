const { fixPayees, calculateMortage, ghostfolioSync, holdAmoutForNextMonth, bankSync } = require("./engine.js");
var cron = require('node-cron');
const parser = require('cron-parser');
const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();

var cronExpression = "0 */4 * * *";
if (appConfig.CRON_EXPRESSION != "") {
    cronExpression = appConfig.CRON_EXPRESSION;
}
console.info("Defined cron is: ", cronExpression)
const interval = parser.parseExpression(cronExpression);
console.info('Next run:', interval.next().toISOString());

if (appConfig.ENABLE_INTEREST_CALCULATION) {
    console.info("Task interest calculation enabled");
}

if (appConfig.ENABLE_PAYEE_RENAME) {
    console.info("Task fix payees enabled");
}

if (appConfig.ENABLE_GHOSTFOLIO_SYNC) {
    console.info("Task ghostfolio sync enabled");
}

if (appConfig.ENABLE_HOLD_INCOME_FOR_NEXT_MONTH){
    console.info("Task hold for next month enabled");
}

if (appConfig.ENABLE_BANK_SYNC) {
    console.info("Task bank sync enabled");
}

cron.schedule(cronExpression, async () => {
    if (appConfig.ENABLE_INTEREST_CALCULATION) {
        console.info("Running interest calculation");
        await calculateMortage();
    }

    if (appConfig.ENABLE_PAYEE_RENAME) {
        console.info("Running fix payees");
        await fixPayees();
    }

    if (appConfig.ENABLE_GHOSTFOLIO_SYNC) {
        console.info("Running ghostfolio sync");
        await ghostfolioSync();
    }

    if (appConfig.ENABLE_HOLD_INCOME_FOR_NEXT_MONTH){
        console.info("Running hold for next month");
        await holdAmoutForNextMonth();
    }

    if (appConfig.ENABLE_BANK_SYNC){
        console.info("Running bank sync");
        await bankSync();
    }
    console.info('Next run:', interval.next().toISOString());
});

