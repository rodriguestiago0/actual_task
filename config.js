const Conf = require("conf");
const config = require("dotenv").config;
config();


const INTEREST_RATE = process.env.INTEREST_RATE || "";
const MORATEGE_PAYEE_ID = process.env.MORATEGE_PAYEE_ID || "";
const MORATEGE_PAYEE_NAME = process.env.MORATEGE_PAYEE_NAME || "";
const MORATEGE_ACCOUNT_ID = process.env.MORATEGE_ACCOUNT_ID || "";
const MAIN_ACCOUNT_ID = process.env.MAIN_ACCOUNT_ID || "";
const MORATEGE_CATEGORY_ID = process.env.MORATEGE_CATEGORY_ID || "";

const PAYEE_REGEX_MATCH = process.env.PAYEE_REGEX_MATCH || "";

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL || "";
const ACTUAL_SERVER_PASSWORD = process.env.ACTUAL_SERVER_PASSWORD || "";

const APP_PORT = process.env.APP_PORT || 3000;

const APP_URL = process.env.APP_URL || "http://localhost"

const CRON_EXPRESSION = process.env.CRON_EXPRESSION || "";
const ACTUAL_SYNC_ID = process.env.ACTUAL_SYNC_ID || "";


function getAppConfigFromEnv() {
    
    const appConfig = {
        APP_PORT,
        APP_URL,
        ACTUAL_SERVER_URL,
        ACTUAL_SERVER_PASSWORD,
        ACTUAL_SYNC_ID,
        CRON_EXPRESSION,
        PAYEE_REGEX_MATCH,
        MORATEGE_PAYEE_ID,
        MORATEGE_PAYEE_NAME,
        MORATEGE_ACCOUNT_ID,
        MAIN_ACCOUNT_ID,
        INTEREST_RATE,
        MORATEGE_CATEGORY_ID,
    }

    // Assert that all required environment variables are set
    Object.entries(appConfig).forEach(([key, value]) => {
        if (!value) {
            throw new Error(`Missing environment variable: ${key}`);
        }
    })

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
