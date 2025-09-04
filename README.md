# Actual Tasks
This is a project that contains two tasks. You can trigger them manually or setup a docker container that will run them periodically.

## Tasks:

### Fix payee name based on a regex expression:
**Input**: `Compra 1234 Continente Porto Contactless`

**Regex**: `Compra [0-9]{4}|Contactless|Compra:|[0-9]{4}-[0-9]{0,3}`

**Output**: `Continente Porto`

This task will also remove extra space in the payee name.
**Input**: `Continente       Porto` 

**Output**:  `Continente Porto` 

**Note:** In the end it will merge payees with the exact same name

### Create a transaction that deducts your payment mortgage
To configure the correct interest rate is the % multiple by 1000

### Sync ghostfolio account with Actual Budget account
Create a new transaction to keep ghostfolio account balance and actual account balance in sync

### Run bank sync
Run bank sync


## Setup

-   Clone this repo!
-   Install dependencies: `npm ci`
-   Copy `.sample.env` to `.env` and fill in the blanks

## Some things worth noting

This is a repository where I will be adding tasks to run periodically. For now both fixing payees name and calculate mortgage are enabled by default.

## Commands


```
  Usage
    $ actual-tasks <command> <flags>

  Commands & Options
    config                        Print the location of actualplaid the config file
    fix-payees                    Will apply the regex and replace for empty string
    calculate-mortgage             Will check the mortgage balance and calculate the principal payment based on your montly payment
    ghostfolio-sync               Will check ghost balance account and actual account balances and create a transaction in actual to sync both balances.
    hold-amout-for-next-month     Sum all income transaction and hold it to next month budget 
    bank-sync                     Will run the bank sync


  Options for all commands
    --user, -u       Specify the user to load configs for
  Examples
    $ actual-tasks config
```
