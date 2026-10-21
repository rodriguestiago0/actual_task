# Actual Tasks

This project contains several tasks. You can trigger them manually or setup a docker container that will run them periodically.

## Tasks:

### Fix payee name based on a regex expression:

**Input**: `Compra 1234 Continente Porto Contactless`

**Regex**: `Compra [0-9]{4}|Contactless|Compra:|[0-9]{4}-[0-9]{0,3}`

**Output**: `Continente Porto`

This task will also remove extra space in the payee name.
**Input**: `Continente       Porto`

**Output**: `Continente Porto`

**Note:** In the end it will merge payees with the exact same name

### Create a transaction that deducts your payment mortgage

Set `INTEREST_RATE` to the annual rate in % multiplied by 1000 (5.399% → `5399`).

### Sync ghostfolio account with Actual Budget account

Keeps the Actual account balance equal to the Ghostfolio balance with one adjustment transaction per month (added on the first sync, updated afterwards).

### Sync wealthfolio account with Actual Budget account

Keeps the Actual account balance equal to the Wealthfolio balance with one adjustment transaction per month (added on the first sync, updated afterwards).

### Run bank sync

Run bank sync

## Setup

- Requires Node.js 22+
- Clone this repo and install dependencies: `npm ci`
- Copy `.env.sample` to `.env` and fill in the blanks
- Enable tasks with `ENABLE_PAYEE_RENAME`, `ENABLE_INTEREST_CALCULATION`, `ENABLE_GHOSTFOLIO_SYNC`, `ENABLE_WEALTHFOLIO_SYNC`, `ENABLE_BANK_SYNC`
- Run a task: `node index.js fix-payees`, or run enabled tasks on a schedule: `npm start`

## Scheduling

All enabled tasks run on `CRON_EXPRESSION` (default `0 */4 * * *`). Give a task its own schedule
with `<TASK>_CRON`, e.g. `FIX_PAYEES_CRON=*/5 * * * *` or `WEALTHFOLIO_SYNC_CRON=0 8 * * *`.
Tasks never run at the same time. Set `RUN_ON_START=true` to run every enabled task once at
startup.

## Telegram notifications

Set `TELEGRAM_BOT_TOKEN` (from [@BotFather](https://t.me/BotFather)) and `TELEGRAM_CHAT_ID` to
get a message whenever a scheduled task fails. To find your chat id, send the bot a message and
open `https://api.telegram.org/bot<TOKEN>/getUpdates`.

## Logs

Output is timestamped. The Actual API's own verbose logging is hidden unless `DEBUG=1`.

### Get Ghostfolio API key for `.env`

```bash
curl -X POST http://127.0.0.1:3333/api/v1/auth/anonymous -H "Content-Type: application/json" -d '{"accessToken": "<TOKEN>"}'
```

## Commands

```
  Usage
    $ actual-tasks <command>

  Commands
    fix-payees           Strip PAYEE_REGEX_MATCH from payee names and merge duplicates
    calculate-mortgage   Record the principal part of the last mortgage payment
    ghostfolio-sync      Sync Ghostfolio account balances into Actual
    wealthfolio-sync     Sync Wealthfolio account balances into Actual
    bank-sync            Run Actual bank sync
```

## Development

`npm run lint`, `npm run format`, `npm test`.

## Releases

When Dependabot bumps `@actual-app/api`, the PR is auto-merged after CI passes, a new patch
release (`vX.Y.Z` git tag) is created and the Docker image is published to
`rodriguestiago0/actualtasks` (`latest`, `X.Y.Z`, `X.Y`). The git tag is the version source of
truth; `package.json` `version` is not updated.

This requires a fine-grained PAT (Contents + Pull requests: read/write) saved as the
**Dependabot** secret `RELEASE_TOKEN`, "Allow auto-merge" enabled, and the `CI` checks required
on `main`.
