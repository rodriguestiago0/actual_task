### Building and running your application

When you're ready, start your application by running:
`docker compose up --build`.

Docker-comple.yaml example:
```
version: '3'
services:
  actual_server:
    container_name: actualtasks
    image: docker.io/rodriguestiago0/actualtasks
    environment:
      - PUID=1003
      - PGID=100
      - TZ=Europe/Lisbon
      - INTEREST_RATE=
      - MORTGAGE_PAYEE_ID=
      - MORTGAGE_ACCOUNT_ID=
      - MAIN_ACCOUNT_ID=
      - PAYEE_REGEX_MATCH=
      - ACTUAL_SERVER_URL= 
      - ACTUAL_SERVER_PASSWORD=
      - ACTUAL_FILE_PASSWORD=
      - ACTUAL_SYNC_ID=
      - ENABLE_INTEREST_CALCULATION=true
      - ENABLE_PAYEE_RENAME=true
      - CRON_EXPRESSION= # default value is "0 */4 * * *"
      - GHOSTFOLIO_ACCOUNT=
      - GHOSTFOLIO_ACTUAL_ACCOUNT=
      - GHOSTFOLIO_ACTUAL_PAYEE_NAME=
      - ENABLE_GHOSTFOLIO_SYNC=true
      - GHOSTFOLIO_SERVER_URL=
      - GHOSTFOLIO_TOKEN=
      - ENABLE_BANK_SYNC=true
    restart: unless-stopped
```

```
docker run -d --name actualtasks \
    - e 'INTEREST_RATE=' \
    - e 'MORTGAGE_PAYEE_ID=' \
    - e 'MAIN_ACCOUNT_ID=' \
    - e 'MORTGAGE_ACCOUNT_ID=' \
    - e' ENABLE_INTEREST_CALCULATION'=true \
    - e 'ENABLE_PAYEE_RENAME'=true \
    - e 'PAYEE_REGEX_MATCH=' \
    - e 'ACTUAL_SERVER_URL= ' \
    - e 'ACTUAL_SERVER_PASSWORD=' \
    - e 'ACTUAL_FILE_PASSWORD=' \
    - e 'ACTUAL_SYNC_ID=' \
    - e 'CRON_EXPRESSION'= # default value is "0 */4 * '* *"' \
    - e 'GHOSTFOLIO_ACCOUNT'= \
    - e 'GHOSTFOLIO_ACTUAL_ACCOUNT'= \
    - e 'GHOSTFOLIO_ACTUAL_PAYEE_NAME'= \
    - e 'ENABLE_GHOSTFOLIO_SYNC'=true \
    - e 'GHOSTFOLIO_SERVER_URL'= \
    - e 'GHOSTFOLIO_TOKEN'= \
    - e 'ENABLE_BANK_SYNC'=true \
  --restart=on-failure rodriguestiago0/actualtasks:latest
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

### Systemd Units (Optional)

If you are running on a Linux system with `systemd` and want to start and stop the application automatically on a schedule, you can use the provided systemd service and timer units located in the `systemd/` directory.

These units will automatically start and stop the `docker compose` stack based on the defined timers.

1. Edit the service files (`systemd/ghostfolio-start.service` and `systemd/ghostfolio-stop.service`) and update the `WorkingDirectory` to the absolute path of this project directory:
   ```ini
   WorkingDirectory=/absolute/path/to/actual_task
   ```
2. Copy the `.service` and `.timer` files to your systemd directory:
   ```bash
   sudo cp systemd/*.service systemd/*.timer /etc/systemd/system/
   ```
3. Reload the systemd daemon:
   ```bash
   sudo systemctl daemon-reload
   ```
4. Enable and start the timers:
   ```bash
   sudo systemctl enable --now ghostfolio-start.timer
   sudo systemctl enable --now ghostfolio-stop.timer
   ```