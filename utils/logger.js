const fs = require("fs");
const { TESTING_MODE } = require("../config.json");

async function logToTxt(message, type) {
    if (type == "error") {
        message = message.stack || message;
    } else if (typeof message !== "string") {
        message = JSON.stringify(message);
        message = message.replace(/\x1b\[\d+m/g, "");
    }
    const date = new Date();
    const log = `[${date.toLocaleString()}] [${type.toUpperCase()}] ${message}\n`;
    const dir = `./logs/${date.toLocaleDateString("ja-JP").split("/")[0]}/${date.toLocaleDateString("ja-JP").split("/")[1]}`; // japan because format is yyyy/mm/dd, not a weeb!
    const fileFormat = `${dir}/${date.toLocaleDateString("ja-JP").split("/")[2]}.txt`;
    
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFile(fileFormat, log, (err) => {
        if (err) throw err;
    });
}

module.exports = {
    log: (message, type) => {
        if (typeof message !== "string") message = JSON.stringify(message);
        switch (type) {
            case "info":
                console.log(`\x1b[32m[INFO]\x1b[0m ${message}`);
                logToTxt(message, type);
                break;
            case "warn":
                console.log(`\x1b[33m[WARN]\x1b[0m ${message}`);
                logToTxt(message, type);
                break;
            case "error":
                console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`);
                logToTxt(message, type);
                break;
            case "debug":
                console.log(`\x1b[36m[DEBUG]\x1b[0m ${message}`);
                logToTxt(message, type);
                break;
            default:
                console.log(`\x1b[32m[INFO]\x1b[0m ${message}`);
                logToTxt(message, "info");
                break;
        }
    },
    info: (message) => {
        console.log(`\x1b[32m[INFO]\x1b[0m ${message}`);
        logToTxt(message, "info");
    },
    debug: (message) => {
        if (TESTING_MODE) {
            console.log(`\x1b[36m[DEBUG]\x1b[0m ${message}`);
            logToTxt(message, "debug");
        }
    },
    warn: (message) => {
        console.log(`\x1b[33m[WARN]\x1b[0m ${message}`);
        logToTxt(message, "warn");
    },
    error: (message) => {
        console.log(`\x1b[31m[ERROR]\x1b[0m ${message.stack || message}`);
        logToTxt(message, "error");
    }
}
