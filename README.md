# Actual Tasks

## Setup

-   Clone this repo!
-   Install dependencies: `npm ci`
-   Copy `.sample.env` to `.env` and fill in the blanks
-   Run `check`: `node index.js check`, this will check the balance between your Actual Budget account and the accounts setup on tink
-   Run `import`: `node index.js import`, this will import all transactions to Actual

## Some things worth noting

This is a repository where I will be adding tasks to run periodically. For now both fixing payees name and calculate mortage are enabled by default.

## Commands


```
  Usage
    $ myedenredactual <command> <flags>

  Commands & Options
    config              Print the location of actualplaid the config file
    fix-payees          Will apply the regex and replace for empty string
    calculate-mortage   Will check the mortage balance and calculate the principal payment based on your montly payment

  Options for all commands
    --user, -u       Specify the user to load configs for
  Examples
    $ myedenredactual import --account="My Checking" --since="2020-05-28"
```
