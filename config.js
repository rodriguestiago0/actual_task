const Conf = require("conf");
const config = require("dotenv").config;
config();


const INTEREST_RATE = process.env.INTEREST_RATE || "";
const MORTGAGE_PAYEE_ID = process.env.MORTGAGE_PAYEE_ID || "";
const MORTGAGE_PAYEE_NAME = process.env.MORTGAGE_PAYEE_NAME || "";
const MORTGAGE_ACCOUNT_ID = process.env.MORTGAGE_ACCOUNT_ID || "";
const MAIN_ACCOUNT_ID = process.env.MAIN_ACCOUNT_ID || "";
const GHOSTFOLIO_SERVER_URL = process.env.GHOSTFOLIO_SERVER_URL || "";
const GHOSTFOLIO_TOKEN = process.env.GHOSTFOLIO_TOKEN || "";

const PAYEE_REGEX_MATCH = process.env.PAYEE_REGEX_MATCH || "";

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "";
const ACTUAL_SERVER_PASSWORD = process.env.ACTUAL_SERVER_PASSWORD || "";
const ACTUAL_FILE_PASSWORD = process.env.ACTUAL_FILE_PASSWORD || "";


const CRON_EXPRESSION = process.env.CRON_EXPRESSION || "0 */4 * * *";
const ACTUAL_SYNC_ID = process.env.ACTUAL_SYNC_ID || "";

const ENABLE_HOLD_INCOME_FOR_NEXT_MONTH = stringToBoolean(process.env.ENABLE_HOLD_INCOME_FOR_NEXT_MONTH);
const ENABLE_INTEREST_CALCULATION= stringToBoolean(process.env.ENABLE_INTEREST_CALCULATION);
const ENABLE_PAYEE_RENAME = stringToBoolean(process.env.ENABLE_PAYEE_RENAME);
const ENABLE_BANK_SYNC = stringToBoolean(process.env.ENABLE_BANK_SYNC);
const ENABLE_GHOSTFOLIO_SYNC = stringToBoolean(process.env.ENABLE_GHOSTFOLIO_SYNC);


function stringToBoolean(stringValue){
    switch(stringValue?.toLowerCase()?.trim()){
        case "true": 
        case "yes": 
        case "1": 
          return true;

        case "false": 
        case "no": 
        case "0": 
        case null: 
        case undefined:
          return false;

        default: 
          return JSON.parse(stringValue);
    }
}

function validateEnv(variables){
    // Assert that all required environment variables are set
    Object.entries(variables).forEach(([key, value]) => {
        if (!value) {
            throw new Error(`Missing environment variable: ${key}`);
        }
    })
}

function getAppConfigFromEnv() {
    validateEnv({
        ACTUAL_SERVER_URL,
        ACTUAL_SERVER_PASSWORD,
        ACTUAL_SYNC_ID,
        CRON_EXPRESSION,
    })

    if (ENABLE_INTEREST_CALCULATION) {
        validateEnv({
            MORTGAGE_PAYEE_ID,
            MORTGAGE_PAYEE_NAME,
            MORTGAGE_ACCOUNT_ID,
            MAIN_ACCOUNT_ID,
            INTEREST_RATE,
        })
    }

    if (ENABLE_PAYEE_RENAME) {
        validateEnv({
            PAYEE_REGEX_MATCH,
        })
    }
    
    GHOSTFOLIO_ACCOUNT_MAPPING = {}
    GHOSTFOLIO_ACTUAL_PAYEE_NAME_MAPPING = {}
    if (ENABLE_GHOSTFOLIO_SYNC) {
        
        ghostfolioAccount = process.env.GHOSTFOLIO_ACCOUNT
        actualAccount = process.env.GHOSTFOLIO_ACTUAL_ACCOUNT
        ghotfolioPayeeName = process.env.GHOSTFOLIO_ACTUAL_PAYEE_NAME

        if (!ghostfolioAccount){
            throw new Error(`Missing environment variable: GHOSTFOLIO_ACCOUNT`);
        }

        if (!actualAccount){
            throw new Error(`Missing environment variable: GHOSTFOLIO_ACTUAL_ACCOUNT`);
        }

        if (!ghotfolioPayeeName){
            throw new Error(`Missing environment variable: GHOSTFOLIO_ACTUAL_PAYEE_NAME`);
        }

        GHOSTFOLIO_ACCOUNT_MAPPING[ghostfolioAccount] = actualAccount;
        GHOSTFOLIO_ACTUAL_PAYEE_NAME_MAPPING[ghostfolioAccount] = ghotfolioPayeeName;
        var i = 1;
        while(true){
            ghostfolioAccount = process.env[`GHOSTFOLIO_ACCOUNT_${i}`] || ""
            actualAccount = process.env[`GHOSTFOLIO_ACTUAL_ACCOUNT_${i}`] || ""
            ghotfolioPayeeName = process.env[`GHOSTFOLIO_ACTUAL_PAYEE_NAME_${i}`] || ""
            if (!ghostfolioAccount || !actualAccount || !ghotfolioPayeeName) {
                break;
            }
            i++;
            GHOSTFOLIO_ACCOUNT_MAPPING[ghostfolioAccount] = actualAccount;
            GHOSTFOLIO_ACTUAL_PAYEE_NAME_MAPPING[ghostfolioAccount] = ghotfolioPayeeName;
        }

        validateEnv({
            GHOSTFOLIO_SERVER_URL,
            GHOSTFOLIO_TOKEN,
        })
    }

    const appConfig = {
        ACTUAL_SERVER_URL,
        ACTUAL_SERVER_PASSWORD,
        ACTUAL_FILE_PASSWORD,
        ACTUAL_SYNC_ID,
        CRON_EXPRESSION,
        PAYEE_REGEX_MATCH,
        MORTGAGE_PAYEE_ID,
        MORTGAGE_PAYEE_NAME,
        MORTGAGE_ACCOUNT_ID,
        MAIN_ACCOUNT_ID,
        INTEREST_RATE,
        ENABLE_INTEREST_CALCULATION,
        ENABLE_PAYEE_RENAME,
        ENABLE_GHOSTFOLIO_SYNC,
        GHOSTFOLIO_ACCOUNT_MAPPING,
        GHOSTFOLIO_ACTUAL_PAYEE_NAME_MAPPING,
        GHOSTFOLIO_SERVER_URL,
        GHOSTFOLIO_TOKEN,
        ENABLE_HOLD_INCOME_FOR_NEXT_MONTH,
        ENABLE_BANK_SYNC
    }

    return appConfig
}


function getConf(username) {
    const appConfig = getAppConfigFromEnv();
    const key = `${username}`;

    const tmp = new Conf({
        configName: key
    });
    tmp.set("user", key);
    tmp.set("budget_id", appConfig.ACTUAL_SYNC_ID)
    return tmp;
}

module.exports = {
    getAppConfigFromEnv,
    getConf
}
