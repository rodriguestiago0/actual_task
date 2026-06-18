ARG NODE_VERSION=24.11.0

FROM node:${NODE_VERSION}-alpine AS build_image

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev
RUN npm ci --omit=dev

COPY . .

FROM node:${NODE_VERSION}-alpine AS runner_image

WORKDIR /usr/src/app

RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Europe/Rome /etc/localtime && \
    echo "Europe/Rome" > /etc/timezone

COPY --from=build_image /usr/src/app/node_modules ./node_modules
ADD . .
ADD package*.json ./

RUN chmod +x index-cron.js

ENV NODE_ENV=production

# Run the application.
CMD ["node", "index-cron.js"]



