# Running with Docker

The image `rodriguestiago0/actualtasks` is published for `linux/amd64`, `linux/arm64` and
`linux/arm/v7` (the arm/v7 image runs on Node 22). See [README.md](README.md) for what each
variable does.

## Published image

Example `docker-compose.yaml`. Enable only the tasks you have filled in: an enabled task with
missing variables stops the container at startup.

```yaml
services:
  actual-tasks:
    container_name: actual-tasks
    image: docker.io/rodriguestiago0/actualtasks:latest
    environment:
      - TZ=Europe/Lisbon # used for schedules and transaction dates
      - ACTUAL_SERVER_URL=
      - ACTUAL_SERVER_PASSWORD=
      - ACTUAL_SYNC_ID=
      - ACTUAL_FILE_PASSWORD= # optional, for end-to-end encrypted budgets
      - CRON_EXPRESSION= # default "0 */4 * * *"
      - FIX_PAYEES_CRON= # optional per-task schedule, e.g. */5 * * * *
      - RUN_ON_START=false
      - NOTIFICATION_URL= # optional, e.g. telegram://TOKEN@telegram?chats=CHAT_ID
      - DEBUG= # set to 1 for verbose Actual API logs
      - ENABLE_PAYEE_RENAME=false
      - PAYEE_REGEX_MATCH=
      - ENABLE_RULE_MERGE=false
      - ENABLE_INTEREST_CALCULATION=false
      - INTEREST_RATE=
      - MORTGAGE_PAYEE_ID=
      - MORTGAGE_PAYEE_NAME=
      - MORTGAGE_ACCOUNT_ID=
      - MAIN_ACCOUNT_ID=
      - ENABLE_GHOSTFOLIO_SYNC=false
      - GHOSTFOLIO_SERVER_URL=
      - GHOSTFOLIO_ACCESS_TOKEN=
      - GHOSTFOLIO_ACCOUNT=
      - GHOSTFOLIO_ACTUAL_ACCOUNT=
      - GHOSTFOLIO_ACTUAL_PAYEE_NAME=
      - ENABLE_WEALTHFOLIO_SYNC=false
      - WEALTHFOLIO_SERVER_URL=
      - WEALTHFOLIO_ACCOUNT=
      - WEALTHFOLIO_ACTUAL_ACCOUNT=
      - WEALTHFOLIO_ACTUAL_PAYEE_NAME=
      # More Ghostfolio/Wealthfolio accounts: add the three account variables with _1, _2, ...
    restart: unless-stopped
    stop_grace_period: 2m # lets a running task finish on docker stop
```

Secrets can come from files instead of the environment: add `_FILE` to a variable's name, e.g.
`ACTUAL_SERVER_PASSWORD_FILE=/run/secrets/actual_password` with a Compose `secrets:` entry.

### Health check

The scheduler touches `temp_data_actual/last-success` each time every task of a scheduled run
succeeds. To have Docker report the container unhealthy when that is too old, add a health check to the service
with an age a bit over two schedule intervals (9 hours for the default 4-hour schedule), and a
`start_period` longer than one interval so the first run has time to happen:

```yaml
healthcheck:
  test:
    - CMD
    - node
    - -e
    - "const s=require('fs').statSync('temp_data_actual/last-success',{throwIfNoEntry:false});process.exit(s&&Date.now()-s.mtimeMs<9*3600e3?0:1)"
  interval: 5m
  start_period: 5h
```

Run a single task once in the running container:

```bash
docker exec actual-tasks node index.js merge-rules
```

Add `--dry-run` to see what a task would change without saving anything:

```bash
docker exec actual-tasks node index.js merge-rules --dry-run
```

## Building from source

The repo's `docker-compose.yml` builds the image locally and reads its configuration from `.env`:

```bash
cp .env.sample .env   # then fill it in
docker compose up -d --build
```

After pulling new code or changing it locally, rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```
