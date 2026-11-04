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

Each run downloads a fresh copy of the budget into a new `run-*` directory in `ACTUAL_DATA_DIR`
(default `./temp_data_actual`). The budget's database is deleted when the run ends (for an
end-to-end encrypted budget it's the decrypted copy), and the directory itself by a later run or
when the process exits. A lock file in that directory keeps runs apart even across processes: a
`node index.js` run started while the scheduler runs a task (e.g. with `docker exec`) waits for it
to finish, for up to 15 minutes, and the other way round.

Add `--dry-run` (`-n`) to run a task without saving anything, e.g.
`node index.js merge-rules --dry-run`. The task reads the budget and logs what it would do as usual;
calls that would change the budget are skipped and counted, and the task's changes aren't synced.
Imports are previewed with Actual's own dry run.

A dry run still opens the budget the way the app does, so Actual's schedule service runs: due
schedules set to "automatically add" are posted and synced, and finished one-off schedules are
marked completed, as opening the app would. The API offers no way to stop this.

Changes reach the server while the task runs (Actual pushes each one about a second after it's
made), so a task that fails halfway keeps the changes it made before the error.

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

Account IDs are in the app's URL when you open an account (`/accounts/<ID>`). A task fails before
changing anything when one of its account IDs isn't an open account in the budget. Actual doesn't
show payee IDs in the app; get them from the API (`getPayees()`).

### Fix payees

Removes every match of the regex `PAYEE_REGEX_MATCH` from payee names, collapses repeated spaces
and trims the result. The match ignores case (flags `gis`). An invalid regex stops the program at
startup.

| Regex                                                        | Before                                     | After              |
| ------------------------------------------------------------ | ------------------------------------------ | ------------------ |
| `Compra [0-9]{4}\|Contactless\|Compra:\|[0-9]{4}-[0-9]{0,3}` | `Compra 1234 Continente Porto Contactless` | `Continente Porto` |
| (any)                                                        | `Continente       Porto`                   | `Continente Porto` |

The task then **merges every pair of payees with the same name**, ignoring case as Actual does
(`Cafe` and `CAFE`), not only the ones it renamed. Transfer payees, which are named after their
account, are never renamed or merged.

### Merge rules

Folds rules that do the same thing into one rule, so you end up with one rule per payee and one per
category:

| Before                                                                                            | After                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `payee is Zara → category Clothes`<br>`payee is Mango → category Clothes`                         | `payee is one of Zara, Mango → category Clothes`                    |
| `imported payee is Compra Zara Porto → payee Zara`<br>`imported payee contains ZARA → payee Zara` | `imported payee is Compra Zara Porto or contains ZARA → payee Zara` |

Rules are merged when they are in the same stage, compare a single field with "is", "is one of" or
"contains", and have exactly the same actions. Rules whose conditions must all match are merged too
when they have the same actions and differ only in one "is"/"is one of" condition (payee first,
then imported payee, account, category), e.g. `payee is Ana and amount < 0 → Loan` and `payee is
Rui and amount < 0 → Loan` become `payee is one of Ana, Rui and amount < 0 → Loan`. The merged rule keeps one of the rules' IDs; the
others are deleted. Other rules that are exact duplicates are deleted, keeping one.

Merging changes the order Actual runs rules in, so rules that can match the same text with
different actions are left alone and logged as a warning, for you to fix in Actual:

- the same value, e.g. `payee is Doce Alto → Coffee` and `payee is Doce Alto → Restaurant`;
- a "contains" value found in another rule's value, e.g. `imported payee contains Continente →
Continente` and `imported payee is Continente Bom Dia → Bom Dia`;
- a merge that would change the order of rules that can match the same transaction, when one sets
  a field the other sets or reads. Actual runs each stage's rules from the least to the most
  specific ("is" scores more than "is one of", which scores more than "contains"), then by ID, and
  the last one wins. E.g. merging `payee is Zara → Gifts` and `payee is Mango → Gifts` would move
  them before `imported payee is Zara Lisboa → Clothes`, so a Zara Lisboa purchase would end as
  Clothes instead of Gifts. Rules that need different values of the same field, e.g. `payee is
Zara` and `payee is Pingo Doce`, can't match the same transaction and are merged as usual.

Two "contains" rules always count as able to match the same transaction, as both values can be
found in one text (`contains ZARA` and `contains LISBOA`).

When run by the scheduler, these conflicts are also sent as a notification, once until they change.

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
   positive transaction dated today. When that isn't part of the payment (more than the payment,
   or not positive, e.g. a refund or a wrong `INTEREST_RATE`), it records nothing and warns
   instead.

`INTEREST_RATE` must be a whole number between 1 and 99999; a percentage such as `5.399` is
rejected at startup.

`MORTGAGE_PAYEE_NAME` must be the name of `MORTGAGE_PAYEE_ID`. Otherwise step 2 never finds the
earlier transaction and the principal is recorded on every run.

### Ghostfolio and Wealthfolio sync

Keeps an Actual account's balance equal to an account's balance in
[Ghostfolio](https://ghostfol.io) or [Wealthfolio](https://wealthfolio.app). Every sync that finds a
difference adds an adjustment transaction for it, so the schedule sets how often you get one (e.g.
`GHOSTFOLIO_SYNC_CRON` once a day for one transaction a day).

| Ghostfolio                     | Wealthfolio                     | Meaning                              |
| ------------------------------ | ------------------------------- | ------------------------------------ |
| `GHOSTFOLIO_SERVER_URL`        | `WEALTHFOLIO_SERVER_URL`        | Server URL, e.g. `http://host:3333`  |
| `GHOSTFOLIO_ACCESS_TOKEN`      | —                               | Security token, see below            |
| `GHOSTFOLIO_ACCOUNT`           | `WEALTHFOLIO_ACCOUNT`           | Account ID in Ghostfolio/Wealthfolio |
| `GHOSTFOLIO_ACTUAL_ACCOUNT`    | `WEALTHFOLIO_ACTUAL_ACCOUNT`    | Actual account ID                    |
| `GHOSTFOLIO_ACTUAL_PAYEE_NAME` | `WEALTHFOLIO_ACTUAL_PAYEE_NAME` | Payee of the adjustment transaction  |

To sync more accounts, add the same three account variables with a `_1`, `_2`, ... suffix (e.g.
`GHOSTFOLIO_ACCOUNT_1`, `GHOSTFOLIO_ACTUAL_ACCOUNT_1`, `GHOSTFOLIO_ACTUAL_PAYEE_NAME_1`). Numbering
stops at the first set with a missing variable; the variables it ignores are logged at startup.

Ghostfolio balances are in the Ghostfolio account's own currency (its `value`, not
`valueInBaseCurrency`), not your base currency. Map each one to an Actual account in that currency.
Turn off **Restricted view** in Ghostfolio for this user: it hides the values, and accounts without
a balance are skipped with a warning. Accounts are read from `GET /api/v1/accounts`, or from
`/api/v1/account` on Ghostfolio before 3.94.0.

An account whose balance drops to exactly 0 while the Actual account isn't empty is skipped with a
warning, because Ghostfolio reports 0 for an account it has no valuation for. Set
`GHOSTFOLIO_ALLOW_ZERO_BALANCE=true` (or `WEALTHFOLIO_ALLOW_ZERO_BALANCE=true`) to sync it anyway,
e.g. after selling everything in it.

Wealthfolio is called without authentication. Before reading balances, the task asks Wealthfolio to
refresh valuations (`POST /api/v1/portfolio/update`).

#### Ghostfolio token

Set `GHOSTFOLIO_ACCESS_TOKEN` to the security token you sign in to Ghostfolio with. On each run the
task exchanges it for a fresh bearer token (`POST /api/v1/auth/anonymous`), so nothing expires.

The older `GHOSTFOLIO_TOKEN`, a bearer token you got from that endpoint yourself, still works when
`GHOSTFOLIO_ACCESS_TOKEN` isn't set, but it expires after 180 days, after which the sync fails
with a 401 error. Replace it with `GHOSTFOLIO_ACCESS_TOKEN`.

### Bank sync

Runs Actual's bank sync for all linked accounts (GoCardless, SimpleFIN, ...), as if you clicked
**Bank Sync** in the app. Accounts must already be linked in Actual. It logs how many transactions
it added and matched; when several accounts fail, Actual reports only the first error.

## Scheduling

`npm start` runs all enabled tasks on `CRON_EXPRESSION`, which defaults to `0 */4 * * *` (every 4
hours, standard 5-field cron syntax; a 6th leading field sets seconds, so `* * * * * *` runs every
second). To give one task its own schedule, set a variable named after
its command in upper case with `_CRON` appended:

`CALCULATE_MORTGAGE_CRON`, `FIX_PAYEES_CRON`, `MERGE_RULES_CRON`, `GHOSTFOLIO_SYNC_CRON`, `WEALTHFOLIO_SYNC_CRON`,
`BANK_SYNC_CRON`

`npm start` exits with status 1 when the configuration is invalid or no task is enabled, after
sending the error as a notification when `NOTIFICATION_URL` is valid (once until the error changes,
so a container restarting on it doesn't notify on every restart). Names that match no task are logged as a warning and ignored. Tasks never run at the same time, including runs started by hand (see the lock above). Set `RUN_ON_START=true` to
also run every enabled task once at startup. On `SIGTERM`/`SIGINT`, the running task finishes
before the process exits, and the tasks left in its batch are skipped. Schedules and transaction dates use the local time
zone (`TZ`).

When Actual's server can't be reached while opening the budget, the run retries twice, after 10
and 30 seconds. A task still running after `TASK_TIMEOUT_MINUTES` (default 30, `0` turns it off)
is logged and notified; it isn't stopped, as the Actual API holds one budget for the whole process,
so the next tasks wait for it.

## Notifications

When a task run by the scheduler fails, you get a message (again only when the error changes), and
another one the next time it succeeds. You also get merge-rules' conflicts and Ghostfolio/Wealthfolio accounts that weren't
found, had no balance or dropped to 0, once until they change; when there are too many for one message, the rest are counted and
left in the logs. Runs started from the command line don't
send notifications.

Set `NOTIFICATION_URL` to one or more space-separated URLs. They use the same format as
[Watchtower](https://containrrr.dev/watchtower/notifications/) (Shoutrrr), so you can reuse existing
Watchtower URLs:

| Service  | URL                                                                                           |
| -------- | --------------------------------------------------------------------------------------------- |
| Telegram | `telegram://BOT_TOKEN@telegram?chats=CHAT_ID[,CHAT_ID]`                                       |
| Discord  | `discord://TOKEN@WEBHOOK_ID`                                                                  |
| Slack    | `slack://hook:T-B-X@webhook` (from `https://hooks.slack.com/services/T/B/X`)                  |
| Email    | `smtp://USER:PASSWORD@HOST:PORT/?fromaddress=ADDRESS&toaddresses=ADDRESS[,ADDRESS]`           |
| ntfy     | `ntfy://[USER:PASSWORD@]HOST/TOPIC`                                                           |
| Gotify   | `gotify://HOST/APP_TOKEN`                                                                     |
| Webhook  | `generic+https://[USER:PASSWORD@]HOST/PATH` (POSTs JSON `{"title": "...", "message": "..."}`) |

Query parameter names ignore case, as in Shoutrrr. Telegram also accepts `channels=` instead of
`chats=`, as older Watchtower URLs use it, and email also accepts the shorter `from=` and `to=`.

The webhook follows Shoutrrr's generic service: `@Name=value` parameters are sent as headers (e.g.
`@Authorization=Bearer%20TOKEN`), `$name=value` ones as extra JSON fields, credentials in the URL
as Basic auth, and `titlekey=`, `messagekey=` and `requestmethod=` rename the fields or change the
method. Other parameters stay on the target URL. Unlike Shoutrrr, it always sends JSON, with or
without `template=json`.

URL-encode special characters in credentials (e.g. `@` → `%40`). Email follows Shoutrrr's
`encryption=` values: `Auto` (default) uses implicit TLS on port 465 and STARTTLS on other ports,
`ImplicitTLS` and `ExplicitTLS` (STARTTLS) force one or the other, and `None` sends in clear text.
STARTTLS is required: if the server doesn't offer it, the email fails instead of being sent
unencrypted. For a relay without TLS, set `encryption=None` (or Shoutrrr's `usestarttls=No`). For
plain-HTTP servers, add `?scheme=http` (ntfy) or `?disabletls=yes` (Gotify).

## Logs

Output is timestamped. The Actual API's own verbose logging is hidden unless `DEBUG=1`.

Boolean variables (`ENABLE_*`, `RUN_ON_START`, ...) accept `true`/`yes`/`1` and `false`/`no`/`0`
in any case; anything else stops the program at startup.

## Development

`npm run lint`, `npm run format`, `npm test`. Release process: [RELEASING.md](RELEASING.md).
