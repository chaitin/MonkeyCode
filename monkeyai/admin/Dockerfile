# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

USER nginx

EXPOSE 8080

ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
