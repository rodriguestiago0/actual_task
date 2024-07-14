const Conf = require("conf");
const config = require("dotenv").config;
config();


const INTEREST_RATE = process.env.INTEREST_RATE || "";
const MORTGAGE_PAYEE_ID = process.env.MORTGAGE_PAYEE_ID || "";
const MORTGAGE_PAYEE_NAME = process.env.MORTGAGE_PAYEE_NAME || "";
const MORTGAGE_ACCOUNT_ID = process.env.MORTGAGE_ACCOUNT_ID || "";
const MAIN_ACCOUNT_ID = process.env.MAIN_ACCOUNT_ID || "";

const ENABLE_INTEREST_CALCULATION= process.env.ENABLE_INTEREST_CALCULATION || false;
const ENABLE_PAYEE_RENAME = process.env.ENABLE_PAYEE_RENAME || false;

const PAYEE_REGEX_MATCH = process.env.PAYEE_REGEX_MATCH || "";

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "";
const ACTUAL_SERVER_PASSWORD = process.env.ACTUAL_SERVER_PASSWORD || "";


const CRON_EXPRESSION = process.env.CRON_EXPRESSION || "";
const ACTUAL_SYNC_ID = process.env.ACTUAL_SYNC_ID || "";

function validateEnv(variables){
    // Assert that all required environment variables are set
    Object.entries(variables).forEach(([key, value]) => {
        if (!value) {
            throw new Error(`Missing environment variable: ${key}`);
        }
    })
}

function getAppConfigFromEnv() {
    
    const appConfig = {
        ACTUAL_SERVER_URL,
        ACTUAL_SERVER_PASSWORD,
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
    }

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
