const { getConf } = require("./config.js");
const { fixPayees, calculateMortage, ghostfolioSync, holdAmoutForNextMonth, bankSync } = require("./engine.js");

let config;

/**
 * 
 * @param {string} command 
 * @param {object} flags 
 * @param {string} flags.since
 */
module.exports = async (command, flags) => {
    if (!command) {
        console.log('Try "actualtasks --help"');
        process.exit();
    }

    config = getConf(flags.user || "default")

    if (command === "config") {
        console.log(`Config for this app is located at: ${config.path}`);
    } else if (command === "fix-payees") {
        await fixPayees();
    } else if (command === "calculate-mortage") {
        await calculateMortage();
    }  else if (command === "ghostfolio-sync") {
        await ghostfolioSync();
    } else if (command === "hold-amout-for-next-month")  {
        await holdAmoutForNextMonth();
    } else if (command === "bank-sync")  {
        await bankSync();
    }
    process.exit();
};
