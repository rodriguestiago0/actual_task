const { fixPayees, calculateMortage, init } = require("./engine.js");
var cron = require('node-cron');
const parser = require('cron-parser');
const { getAppConfigFromEnv } = require("./config");

const appConfig = getAppConfigFromEnv();

var cronExpression = "0 0 */4 * * *";
if (appConfig.CRON_EXPRESSION != "") {
    cronExpression = appConfig.CRON_EXPRESSION
}
console.info("Defined cron is: ", cronExpression)
const interval = parser.parseExpression(cronExpression);
console.info('Next run:', interval.next().toISOString());

cron.schedule(cronExpression, async () => {
    await fixPayees();
    await calculateMortage();
    console.info('Next run:', interval.next().toISOString());
});

