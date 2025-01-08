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
        try{
            await fixPayees();
        } catch (e){
            console.error(e);
        }
    } else if (command === "calculate-mortage") {
         try{
            await calculateMortage();
        } catch (e){
            console.error(e);
        }
    }  else if (command === "ghostfolio-sync") {
        try{
            await ghostfolioSync();
        } catch (e){
            console.error(e);
        }
    } else if (command === "hold-amout-for-next-month")  {
        try{
            await holdAmoutForNextMonth();
        } catch (e){
            console.error(e);
        }
    } else if (command === "bank-sync")  {
        try{
            await bankSync();
        } catch (e){
            console.error(e);
        }
    }
    process.exit();
};
