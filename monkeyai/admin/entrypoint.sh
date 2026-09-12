#!/bin/sh
set -eu

if [ "${1:-}" != nginx ]; then
    exec "$@"
fi

fail() {
    printf 'MonkeyAI: %s\n' "$1" >&2
    exit 1
}

origin() {
    value=${1%/}
    printf '%s\n' "$value" | LC_ALL=C awk '
        NR != 1 { exit 1 }
        !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/ { exit 1 }
        {
            sub(/^https:\/\//, "")
            split($0, authority, ":")
            host = tolower(authority[1])
            port = authority[2]
            if (length(host) > 253 || host ~ /^[0-9.]+$/ || host ~ /(^|\.)localhost$/) exit 1
            count = split(host, labels, ".")
            if (count < 2) exit 1
            for (i = 1; i <= count; i++) {
                if (length(labels[i]) > 63 || labels[i] !~ /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/) exit 1
            }
            if (port != "" && (length(port) > 5 || port + 0 < 1 || port + 0 > 65535)) exit 1
            printf "https://%s", host
            if (port != "" && port + 0 != 443) printf ":%d", port
            printf "\n"
        }
    '
}

umask 077
mkdir -p /tmp/nginx

case "${MONKEYAI_AUTO_TLS_ENABLED:-false}" in
    false)
        cp /etc/nginx/monkeyai/http.conf /tmp/nginx/site.conf
        ;;
    true)
        MONKEYAI_ORIGIN=$(origin "${MONKEYAI_PUBLIC_URL:-}") ||
            fail '自动证书要求 MONKEYAI_PUBLIC_URL 为 HTTPS 域名根地址，不支持 IP、泛域名或路径前缀'
        MONKEYAI_DOMAIN=${MONKEYAI_ORIGIN#https://}
        MONKEYAI_DOMAIN=${MONKEYAI_DOMAIN%%:*}

        MONKEYAI_AUTO_TLS_EMAIL=${MONKEYAI_AUTO_TLS_EMAIL:-}
        printf '%s\n' "$MONKEYAI_AUTO_TLS_EMAIL" | LC_ALL=C awk 'NR != 1 || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/ { exit 1 }' ||
            fail '请设置有效的 MONKEYAI_AUTO_TLS_EMAIL 联系邮箱'
        MONKEYAI_AUTO_TLS_CA=${MONKEYAI_AUTO_TLS_CA:-https://acme-v02.api.letsencrypt.org/directory}
        printf '%s\n' "$MONKEYAI_AUTO_TLS_CA" | LC_ALL=C awk 'NR != 1 || !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~\/-]+)?$/ { exit 1 }' ||
            fail 'MONKEYAI_AUTO_TLS_CA 必须为 HTTPS ACME 目录地址，不支持用户信息、查询参数或片段'

        ca_id=$(printf '%s' "$MONKEYAI_AUTO_TLS_CA" | sha256sum | cut -d ' ' -f 1)
        MONKEYAI_ACME_STATE=/var/lib/nginx/acme/$ca_id
        mkdir -p "$MONKEYAI_ACME_STATE" || fail 'ACME 数据卷不可写，请检查 nginx 用户的目录权限'
        [ -w "$MONKEYAI_ACME_STATE" ] || fail 'ACME 数据卷不可写，请检查 nginx 用户的目录权限'
        export MONKEYAI_ORIGIN MONKEYAI_DOMAIN MONKEYAI_AUTO_TLS_EMAIL MONKEYAI_AUTO_TLS_CA MONKEYAI_ACME_STATE
        envsubst '${MONKEYAI_ORIGIN} ${MONKEYAI_DOMAIN} ${MONKEYAI_AUTO_TLS_EMAIL} ${MONKEYAI_AUTO_TLS_CA} ${MONKEYAI_ACME_STATE}' \
            < /etc/nginx/monkeyai/acme.conf.template > /tmp/nginx/site.conf
        printf 'MonkeyAI: 已启用 %s 的自动证书，首次签发完成前 HTTPS 暂不可用\n' "$MONKEYAI_DOMAIN" >&2
        ;;
    *) fail 'MONKEYAI_AUTO_TLS_ENABLED 只能为 true 或 false' ;;
esac

nginx -t
exec "$@"
