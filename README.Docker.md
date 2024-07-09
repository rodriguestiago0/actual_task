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
      - MORATEGE_PAYEE_ID=
      - MORATEGE_ACCOUNT_ID=
      - MAIN_ACCOUNT_ID=
      - MORATEGE_CATEGORY_ID=
      - PAYEE_REGEX_MATCH=
      - ACTUAL_SERVER_URL= 
      - ACTUAL_SERVER_PASSWORD=
      - ACTUAL_SYNC_ID=
      - CRON_EXPRESSION= # default value is "0 */4 * * *"
    restart: unless-stopped
```

```
docker run -d --name actualtasks \
    - e 'INTEREST_RATE=' \
    - e 'MORATEGE_PAYEE_ID=' \
    - e 'MAIN_ACCOUNT_ID=' \
    - e 'MORATEGE_ACCOUNT_ID=' \
    - e 'MORATEGE_CATEGORY_ID=' \
    - e 'PAYEE_REGEX_MATCH=' \
    - e 'ACTUAL_SERVER_URL= ' \
    - e 'ACTUAL_SERVER_PASSWORD=' \
    - e 'ACTUAL_SYNC_ID=' \
    - e CRON_EXPRESSION= # default value is "0 */4 * '* *"' \
  --restart=on-failure rodriguestiago0/actualtasks:latest
```