ARG NODE_VERSION=24.11.0

FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Lets TZ (e.g. Europe/Lisbon) set the date used for new transactions.
RUN apk add --no-cache tzdata

COPY package*.json ./
# better-sqlite3 ships prebuilt binaries (incl. musl), so its node-gyp script is not needed.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY index.js index-cron.js ./
COPY src ./src

RUN mkdir temp_data_actual && chown node:node temp_data_actual
USER node

CMD ["node", "index-cron.js"]
