### Building and running your application

When you're ready, start your application by running:
`docker compose up --build`.

Images are published for `linux/amd64`, `linux/arm64` and `linux/arm/v7` (the latter runs on Node 22).

`docker-compose.yaml` example:

```yaml
services:
  actual-tasks:
    container_name: actual-tasks
    image: docker.io/rodriguestiago0/actualtasks:latest
    environment:
      - TZ=Europe/Lisbon
      - ACTUAL_SERVER_URL=
      - ACTUAL_SERVER_PASSWORD=
      - ACTUAL_FILE_PASSWORD=
      - ACTUAL_SYNC_ID=
      - CRON_EXPRESSION= # default "0 */4 * * *"
      - FIX_PAYEES_CRON=*/5 * * * * # optional per-task schedule
      - RUN_ON_START=false
      - TELEGRAM_BOT_TOKEN= # optional, failure notifications
      - TELEGRAM_CHAT_ID=
      - ENABLE_PAYEE_RENAME=true
      - PAYEE_REGEX_MATCH=
      - ENABLE_INTEREST_CALCULATION=true
      - INTEREST_RATE=
      - MORTGAGE_PAYEE_ID=
      - MORTGAGE_PAYEE_NAME=
      - MORTGAGE_ACCOUNT_ID=
      - MAIN_ACCOUNT_ID=
      - ENABLE_WEALTHFOLIO_SYNC=true
      - WEALTHFOLIO_SERVER_URL=
      - WEALTHFOLIO_ACCOUNT=
      - WEALTHFOLIO_ACTUAL_ACCOUNT=
      - WEALTHFOLIO_ACTUAL_PAYEE_NAME=
      - ENABLE_BANK_SYNC=true
    restart: unless-stopped
```

### Using `docker-compose.yml`

Alternatively, you can use the provided `docker-compose.yml` to build and run the application. It automatically uses the `.env` file for configuration variables.

1. Ensure you have copied `.env.sample` to `.env` and filled in your configuration values:
   ```bash
   cp .env.sample .env
   ```
2. Start the stack in the background:

   ```bash
   docker compose up -d --build
   ```

3. **Updating the Code**: If you pull new updates or modify the script code locally, you should rebuild the image without caching to ensure changes take effect:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```
