ARG NODE_VERSION=20.11.1

FROM node:${NODE_VERSION}-alpine AS BUILD_IMAGE

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev
RUN npm ci --omit=dev

COPY . .

FROM node:${NODE_VERSION}-alpine AS RUNNER_IMAGE

WORKDIR /usr/src/app

COPY --from=BUILD_IMAGE /usr/src/app/node_modules ./node_modules
ADD . .
ADD package*.json ./


RUN chmod +x index-cron.js

ENV NODE_ENV production

# Run the application.
CMD node index-cron.js



