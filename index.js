#!/usr/bin/env node
const meow = require("meow");
const engine = require("./cli.js");

const cli = meow(
    `
  Usage
    $ actualtasks <command> <flags>

  Commands & Options
    config                       Print the location of actualtasks the config file
    fix-payees                   Apply the regex configured and remove it
    calculate-mortage            Calculate the principal from the mortage payment
    ghostfolio-sync              Sync Ghostfolio balance accounts with actual accounts
    hold-amout-for-next-month    Call sync method


  Options for all commands
    --user, -u       Specify the user to load configs for 

  Examples
    $ actualtasks config
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

engine(cli.input[0], cli.flags);

