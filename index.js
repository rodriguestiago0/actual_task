#!/usr/bin/env node
import meow from 'meow';
import engine from './cli.js';

const cli = meow(
  `
    Usage
      $ actualtasks <command> <flags>

    Commands & Options
      config                       Print the location of actualtasks the config file
      fix-payees                   Apply the regex configured and remove it
      calculate-mortgage            Calculate the principal from the mortgage payment
      ghostfolio-sync              Sync Ghostfolio balance accounts with actual accounts
      wealthfolio-sync             Sync Wealthfolio balance accounts with actual accounts
      hold-amout-for-next-month    Call sync method


    Options for all commands
      --user, -u       Specify the user to load configs for 

    Examples
      $ actualtasks config
  `,
  {
    importMeta: import.meta,
});

engine(cli.input[0]);

