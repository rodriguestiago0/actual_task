# Versions are written out (not ARGs) so Dependabot can update them, with the digest pinned so a
# retagged base image can't change a build.
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS node-amd64
FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS node-arm64
# Node 24 has no 32-bit ARM images, so linux/arm/v7 is built on Node 22 LTS.
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS node-arm

FROM node-${TARGETARCH} AS deps
WORKDIR /usr/src/app
COPY package*.json ./
# better-sqlite3 ships prebuilt binaries for amd64/arm64 (musl); other platforms compile it.
RUN npm ci --omit=dev --ignore-scripts \
    && if ! node -e "new (require('better-sqlite3'))(':memory:')" 2>/dev/null; then \
         apk add --no-cache python3 make g++ \
         && cd node_modules/better-sqlite3 \
         && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release \
         && node -e "new (require('better-sqlite3'))(':memory:')"; \
       fi

FROM node-${TARGETARCH}

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY package*.json index.js index-cron.js ./
COPY src ./src

RUN mkdir temp_data_actual && chown node:node temp_data_actual
USER node

CMD ["node", "index-cron.js"]
