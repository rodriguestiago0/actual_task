#!/usr/bin/env node
const meow = require("meow");
const myedenred = require("./cli.js");

const cli = meow(
    `
  Usage
    $ myedenred <command> <flags>

  Commands & Options
    ls               List currently syncing accounts
    import           Sync bank accounts to Actual Budget
    config           Print the location of myedenredactual the config file
    --version        Print the version of myedenredactual being used

  Options for all commands
    --user, -u       Specify the user to load configs for 

  Examples
    $ myedenred import
`,
    {
        flags: {
            user: {
                alias: "u",
                type: "string",
            },
            account: {
                alias: "a",
                type: "string",
            },
            since: {
                alias: "s",
                type: "string",
            },
        },
    }
);

myedenred(cli.input[0], cli.flags);

