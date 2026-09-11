# syntax=docker/dockerfile:1.7

FROM nginx:1.30.4-alpine@sha256:dc5069ad14f19660b141b21236140b91656bf89bbc3e2417c70ae650cd66104c AS nginx-base

FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx-base AS acme-builder

RUN apk add --no-cache cargo clang-dev openssl-dev pkgconf make gcc musl-dev pcre2-dev zlib-dev linux-headers patch

WORKDIR /build
ADD --checksum=sha256:4261dc90e9e47c1c4041276e9aaa3d48ebe2e664f728e14fa95ae6c67d57a08b https://nginx.org/download/nginx-1.30.4.tar.gz /tmp/nginx.tar.gz
ADD --checksum=sha256:b4f99f971bd0bebc89b2037f3afeaa3281004fe434de558df87d69cab2be1f22 https://codeload.github.com/nginx/nginx-acme/tar.gz/refs/tags/v0.4.1 /tmp/acme.tar.gz
COPY patches/acme-renewal-retry.patch /tmp/acme-renewal-retry.patch
RUN tar -xzf /tmp/nginx.tar.gz \
    && tar -xzf /tmp/acme.tar.gz \
    && cd nginx-1.30.4 \
    && ./configure --with-compat --with-http_ssl_module \
    && cd ../nginx-acme-0.4.1 \
    && patch -p1 < /tmp/acme-renewal-retry.patch

WORKDIR /build/nginx-acme-0.4.1
RUN --mount=type=cache,target=/root/.cargo/registry \
    NGINX_BUILD_DIR=/build/nginx-1.30.4/objs cargo build --locked --release

FROM nginx-base AS runtime

RUN apk add --no-cache ca-certificates libgcc \
    && mkdir -p /var/lib/nginx/acme \
    && chown nginx:nginx /var/lib/nginx/acme \
    && chmod 700 /var/lib/nginx/acme

COPY --from=acme-builder /build/nginx-acme-0.4.1/target/release/libnginx_acme.so /usr/lib/nginx/modules/ngx_http_acme_module.so
COPY --from=acme-builder /build/nginx-acme-0.4.1/LICENSE /usr/share/licenses/nginx-acme/LICENSE
COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx/ /etc/nginx/monkeyai/
COPY --chmod=755 entrypoint.sh /usr/local/bin/monkeyai-entrypoint

USER nginx

EXPOSE 8080 8443

ENTRYPOINT ["/usr/local/bin/monkeyai-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]

FROM runtime
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html
