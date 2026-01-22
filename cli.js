const { fixPayees, calculateMortgage, ghostfolioSync, wealthfolioSync, bankSync } = require("./engine.js");

let config;

/**
 * 
 * @param {string} command 
 * @param {object} flags 
 * @param {string} flags.since
 */
module.exports = async (command) => {
    if (!command) {
        console.log('Try "actualtasks --help"');
        process.exit();
    }

    if (command === "fix-payees") {
        try{
            await fixPayees();
        } catch (e){
            console.error(e);
        }
    } else if (command === "calculate-mortgage") {
         try{
            await calculateMortgage();
        } catch (e){
            console.error(e);
        }
    }  else if (command === "ghostfolio-sync") {
        try{
            await ghostfolioSync();
        } catch (e){
            console.error(e);
        }    
    } else if (command === "wealthfolio-sync") {
        try{
            await wealthfolioSync();
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
