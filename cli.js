const { getConf } = require("./config.js");
const { fixPayees, calculateMortage, ghostfolioSync, holdAmoutForNextMonth } = require("./engine.js");

let config;

const printSyncedAccounts = () => {
    const actualData = config.get("actualSync");
    if (!actualData) {
        console.error("No syncing data found");
        return;
    }

    console.info("The following accounts are linked to Actual:");
    console.table(
        Object.values(actualData).map((account) => ({
            "Actual Account": account.actualName,
            "Actual Account Id": account.actualAccountId,
        }))
    );
};

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
    } else if (command === "holdAmoutForNextMonth")  {
        await holdAmoutForNextMonth();
    }
    else if (command === "ls") {
        printSyncedAccounts();
    }
    process.exit();
};
