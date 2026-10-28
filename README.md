# Actual Tasks

Maintenance tasks for an [Actual Budget](https://actualbudget.org) budget: clean up payee names,
merge rules, record mortgage principal, sync investment balances from Ghostfolio or Wealthfolio, and run bank
sync. Run them once from the command line or on a schedule, either with Node.js or with Docker (see
[README.Docker.md](README.Docker.md)).

## Quick start

1. Requires Node.js 22+. Clone this repo and run `npm ci`.
2. Copy `.env.sample` to `.env` and set:
   - `ACTUAL_SERVER_URL` and `ACTUAL_SERVER_PASSWORD`
   - `ACTUAL_SYNC_ID`, found in Actual under **Settings → Show advanced settings → Sync ID**
   - `ACTUAL_FILE_PASSWORD`, only if the budget uses end-to-end encryption
3. Enable the tasks you want (see [Tasks](#tasks)) and fill in their variables.
4. Run one task: `node index.js fix-payees`. Run every enabled task on a schedule: `npm start`.

A task only runs when its `ENABLE_*` variable is `true`, including when you run it by hand.
`node index.js -h` lists the commands.

Each run downloads a fresh copy of the budget into `ACTUAL_DATA_DIR` (default
`./temp_data_actual`), removing the previous copy first.

> **Back up your budget first.** Renaming and merging payees, and merging rules, can't be undone.

## Tasks

| Command              | Enabled by                    |
| -------------------- | ----------------------------- |
| `fix-payees`         | `ENABLE_PAYEE_RENAME`         |
| `merge-rules`        | `ENABLE_RULE_MERGE`           |
| `calculate-mortgage` | `ENABLE_INTEREST_CALCULATION` |
| `ghostfolio-sync`    | `ENABLE_GHOSTFOLIO_SYNC`      |
| `wealthfolio-sync`   | `ENABLE_WEALTHFOLIO_SYNC`     |
| `bank-sync`          | `ENABLE_BANK_SYNC`            |

Account IDs are in the app's URL when you open an account (`/accounts/<ID>`). Actual doesn't show
payee IDs in the app; get them from the API (`getPayees()`).

### Fix payees

Removes every match of the regex `PAYEE_REGEX_MATCH` from payee names, collapses repeated spaces
and trims the result. The match ignores case (flags `gis`).

| Regex                                                        | Before                                     | After              |
| ------------------------------------------------------------ | ------------------------------------------ | ------------------ |
| `Compra [0-9]{4}\|Contactless\|Compra:\|[0-9]{4}-[0-9]{0,3}` | `Compra 1234 Continente Porto Contactless` | `Continente Porto` |
| (any)                                                        | `Continente       Porto`                   | `Continente Porto` |

The task then **merges every pair of payees with exactly the same name**, not only the ones it
renamed. Transfer payees are never merged.

### Merge rules

Folds rules that do the same thing into one rule, so you end up with one rule per payee and one per
category:

| Before                                                                                            | After                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `payee is Zara → category Clothes`<br>`payee is Mango → category Clothes`                         | `payee is one of Zara, Mango → category Clothes`                    |
| `imported payee is Compra Zara Porto → payee Zara`<br>`imported payee contains ZARA → payee Zara` | `imported payee is Compra Zara Porto or contains ZARA → payee Zara` |

Rules are merged when they are in the same stage, compare a single field with "is", "is one of" or
"contains", and have exactly the same actions. The merged rule keeps one of the rules' IDs; the
others are deleted. Other rules that are exact duplicates are deleted, keeping one.

Merging changes the order Actual runs rules in, so rules that can match the same text with
different actions are left alone and logged as a warning, for you to fix in Actual:

- the same value, e.g. `payee is Doce Alto → Coffee` and `payee is Doce Alto → Restaurant`;
- a "contains" value found in another rule's value, e.g. `imported payee contains Continente →
Continente` and `imported payee is Continente Bom Dia → Bom Dia`.

Set `RULE_MERGE_DRY_RUN=true` to only log what would be merged.

### Calculate mortgage

Records the principal part of your last mortgage payment in the mortgage account, which brings the
debt balance down.

| Variable              | Meaning                                                     |
| --------------------- | ----------------------------------------------------------- |
| `MAIN_ACCOUNT_ID`     | Account the monthly payment leaves from                     |
| `MORTGAGE_ACCOUNT_ID` | Account holding the (negative) mortgage balance             |
| `MORTGAGE_PAYEE_ID`   | Payee of the monthly payment                                |
| `MORTGAGE_PAYEE_NAME` | Name of that same payee, used for the principal transaction |
| `INTEREST_RATE`       | Annual rate in % multiplied by 1000, so 5.399% is `5399`    |

On each run the task:

1. Finds the most recent payment to `MORTGAGE_PAYEE_ID` in `MAIN_ACCOUNT_ID` in the last month,
   and skips if there is none.
2. Skips if the mortgage account already has a transaction from that payee dated on or after
   the payment.
3. Computes interest as `mortgage balance × rate / 12` and records `payment amount − interest` as a
   positive transaction dated today.

`MORTGAGE_PAYEE_NAME` must be the name of `MORTGAGE_PAYEE_ID`. Otherwise step 2 never finds the
earlier transaction and the principal is recorded on every run.

### Ghostfolio and Wealthfolio sync

Keeps an Actual account's balance equal to an account's balance in
[Ghostfolio](https://ghostfol.io) or [Wealthfolio](https://wealthfolio.app), using one adjustment
transaction per month. The first sync in a month adds the transaction; later syncs update its
amount.

| Ghostfolio                     | Wealthfolio                     | Meaning                              |
| ------------------------------ | ------------------------------- | ------------------------------------ |
| `GHOSTFOLIO_SERVER_URL`        | `WEALTHFOLIO_SERVER_URL`        | Server URL, e.g. `http://host:3333`  |
| `GHOSTFOLIO_TOKEN`             | —                               | Bearer token, see below              |
| `GHOSTFOLIO_ACCOUNT`           | `WEALTHFOLIO_ACCOUNT`           | Account ID in Ghostfolio/Wealthfolio |
| `GHOSTFOLIO_ACTUAL_ACCOUNT`    | `WEALTHFOLIO_ACTUAL_ACCOUNT`    | Actual account ID                    |
| `GHOSTFOLIO_ACTUAL_PAYEE_NAME` | `WEALTHFOLIO_ACTUAL_PAYEE_NAME` | Payee of the adjustment transaction  |

To sync more accounts, add the same three account variables with a `_1`, `_2`, ... suffix (e.g.
`GHOSTFOLIO_ACCOUNT_1`, `GHOSTFOLIO_ACTUAL_ACCOUNT_1`, `GHOSTFOLIO_ACTUAL_PAYEE_NAME_1`). Numbering
stops at the first set with a missing variable.

The adjustment transaction is identified by its note, `actual-tasks balance sync`. If you change
the note or reconcile the transaction, the next sync adds a new one.

Wealthfolio is called without authentication. Before reading balances, the task asks Wealthfolio to
refresh valuations (`POST /api/v1/portfolio/update`).

#### Get the Ghostfolio token

Exchange the security token you sign in to Ghostfolio with for a bearer token, and set the returned
`authToken` as `GHOSTFOLIO_TOKEN`:

```bash
curl -X POST http://127.0.0.1:3333/api/v1/auth/anonymous \
  -H "Content-Type: application/json" -d '{"accessToken": "<SECURITY_TOKEN>"}'
```

### Bank sync

Runs Actual's bank sync for all linked accounts (GoCardless, SimpleFIN, ...), as if you clicked
**Bank Sync** in the app. Accounts must already be linked in Actual.

## Scheduling

`npm start` runs all enabled tasks on `CRON_EXPRESSION`, which defaults to `0 */4 * * *` (every 4
hours, standard 5-field cron syntax). To give one task its own schedule, set a variable named after
its command in upper case with `_CRON` appended:

`CALCULATE_MORTGAGE_CRON`, `FIX_PAYEES_CRON`, `MERGE_RULES_CRON`, `GHOSTFOLIO_SYNC_CRON`, `WEALTHFOLIO_SYNC_CRON`,
`BANK_SYNC_CRON`

Names that match no task are logged as a warning and ignored. Tasks never run at the same time. Set `RUN_ON_START=true` to
also run every enabled task once at startup. On `SIGTERM`/`SIGINT`, a running task finishes
before the process exits. Schedules and transaction dates use the local time
zone (`TZ`).

## Notifications

When a task run by the scheduler fails, you get a message, and another one the next time it
succeeds. Runs started from the command line don't
send notifications.

Set `NOTIFICATION_URL` to one or more space-separated URLs. They use the same format as
[Watchtower](https://containrrr.dev/watchtower/notifications/) (Shoutrrr), so you can reuse existing
Watchtower URLs:

| Service  | URL                                                                           |
| -------- | ----------------------------------------------------------------------------- |
| Telegram | `telegram://BOT_TOKEN@telegram?chats=CHAT_ID[,CHAT_ID]`                       |
| Discord  | `discord://TOKEN@WEBHOOK_ID`                                                  |
| Slack    | `slack://hook:T-B-X@webhook` (from `https://hooks.slack.com/services/T/B/X`)  |
| Email    | `smtp://USER:PASSWORD@HOST:PORT/?from=ADDRESS&to=ADDRESS[,ADDRESS]`           |
| ntfy     | `ntfy://[USER:PASSWORD@]HOST/TOPIC`                                           |
| Gotify   | `gotify://HOST/APP_TOKEN`                                                     |
| Webhook  | `generic+https://HOST/PATH` (POSTs JSON `{"title": "...", "message": "..."}`) |

Telegram also accepts `channels=` instead of `chats=`, as older Watchtower URLs use it.

URL-encode special characters in credentials (e.g. `@` → `%40`). Email uses implicit TLS on port
465 and STARTTLS on other ports; set `encryption=None` to disable it. For plain-HTTP servers, add
`?scheme=http` (ntfy) or `?disabletls=yes` (Gotify).

## Logs

Output is timestamped. The Actual API's own verbose logging is hidden unless `DEBUG=1`.

## Development

`npm run lint`, `npm run format`, `npm test`. Release process: [RELEASING.md](RELEASING.md).
