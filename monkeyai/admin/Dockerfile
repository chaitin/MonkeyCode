# syntax=docker/dockerfile:1.7

ARG NGINX_ACME_IMAGE=chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/nginx-acme:1.31.6-acme0.4.1-r1

FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /app

RUN npm install --global https://registry.npmjs.org/pnpm/-/pnpm-10.12.4.tgz \
    --fetch-retries=5 \
    --fetch-retry-mintimeout=10000 \
    --fetch-retry-maxtimeout=60000

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ ./patches/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM ${NGINX_ACME_IMAGE} AS runtime
COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx/ /etc/nginx/monkeyai/
COPY --chmod=755 entrypoint.sh /usr/local/bin/monkeyai-entrypoint

USER nginx

EXPOSE 8080 8443

ENTRYPOINT ["/usr/local/bin/monkeyai-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]

FROM runtime
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
