FROM node:24-alpine AS build

WORKDIR /app

ARG SITE_URL=https://jiying.chat
ARG PUBLIC_BASE_PATH=/
ARG PUBLIC_GA_ID=
ENV SITE_URL=${SITE_URL}
ENV PUBLIC_BASE_PATH=${PUBLIC_BASE_PATH}
ENV PUBLIC_GA_ID=${PUBLIC_GA_ID}

COPY homepage/package.json homepage/package-lock.json ./
RUN npm ci

COPY homepage/astro.config.mjs homepage/tsconfig.json homepage/README.md ./
COPY homepage/public ./public
COPY homepage/src ./src
RUN npm run build

FROM caddy:2-alpine

COPY homepage/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

RUN mkdir -p /srv/releases /var/log/caddy \
  && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

EXPOSE 80 443
