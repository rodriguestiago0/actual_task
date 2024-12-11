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
      - ENABLE_HOLD_INCOME_FOR_NEXT_MONTH=true
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
    - e 'ACTUAL_SYNC_ID=' \
    - e 'CRON_EXPRESSION'= # default value is "0 */4 * '* *"' \
    - e 'GHOSTFOLIO_ACCOUNT'= \
    - e 'GHOSTFOLIO_ACTUAL_ACCOUNT'= \
    - e 'GHOSTFOLIO_ACTUAL_PAYEE_NAME'= \
    - e 'ENABLE_GHOSTFOLIO_SYNC'=true \
    - e 'GHOSTFOLIO_SERVER_URL'= \
    - e 'GHOSTFOLIO_TOKEN'= \
    - e 'ENABLE_HOLD_INCOME_FOR_NEXT_MONTH'=true \
    - e 'ENABLE_BANK_SYNC'=true \
  --restart=on-failure rodriguestiago0/actualtasks:latest
```