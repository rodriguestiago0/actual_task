ARG NODE_VERSION=24.11.0

FROM node:${NODE_VERSION}-alpine AS build_image

WORKDIR /usr/src/app

COPY package*.json ./

RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps

COPY . .

FROM node:${NODE_VERSION}-alpine AS runner_image

WORKDIR /usr/src/app

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/UTC /etc/localtime && \
    echo "UTC" > /etc/timezone

COPY --from=build_image /usr/src/app/node_modules ./node_modules
ADD . .
ADD package*.json ./

RUN chmod +x index-cron.js

ENV NODE_ENV=production

# Run the application.
CMD ["node", "index-cron.js"]



