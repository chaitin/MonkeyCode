#!/bin/sh
set -eu

if [ "${1:-}" != nginx ]; then
    exec "$@"
fi

fail() {
    printf '百智办公: %s\n' "$1" >&2
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

tls_origin() {
    value=${1%/}
    printf '%s\n' "$value" | LC_ALL=C awk '
        NR != 1 || !/^https:\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:[0-9]+)?$/ { exit 1 }
        { print }
    '
}

umask 077
mkdir -p /tmp/nginx

: > /tmp/nginx/real-ip.conf
if [ -n "${MONKEYAI_TRUSTED_PROXY_CIDRS:-}" ]; then
    awk '
        BEGIN {
            count = split(ENVIRON["MONKEYAI_TRUSTED_PROXY_CIDRS"], cidrs, ",")
            for (i = 1; i <= count; i++) {
                if (cidrs[i] == "" || cidrs[i] ~ /[^0-9a-fA-F:.\/]/ || cidrs[i] ~ /\/0+$/) exit 1
                printf "set_real_ip_from %s;\n", cidrs[i]
            }
            exit
        }
    ' > /tmp/nginx/real-ip.conf || fail 'MONKEYAI_TRUSTED_PROXY_CIDRS 必须是逗号分隔的可信代理 IP/CIDR'
    printf 'real_ip_header X-Forwarded-For;\nreal_ip_recursive on;\n' >> /tmp/nginx/real-ip.conf
fi

case "${MONKEYAI_AUTO_TLS_ENABLED:-false}" in
    false)
        case "${MONKEYAI_TLS_ENABLED:-false}" in
            false) cp /etc/nginx/monkeyai/http.conf /tmp/nginx/site.conf ;;
            true)
                MONKEYAI_ORIGIN=$(tls_origin "${MONKEYAI_PUBLIC_URL:-}") || fail '自签 TLS 需要有效的 HTTPS 访问地址'
                [ -r /run/monkeyai/tls/server.crt ] && [ -r /run/monkeyai/tls/server.key ] ||
                    fail '自签 TLS 证书不可读，请检查安装目录 data/tls/server 的权限'
                export MONKEYAI_ORIGIN
                envsubst '${MONKEYAI_ORIGIN}' < /etc/nginx/monkeyai/tls.conf.template > /tmp/nginx/site.conf
                ;;
            *) fail 'MONKEYAI_TLS_ENABLED 只能为 true 或 false' ;;
        esac
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
        printf '百智办公: 已启用 %s 的自动证书，首次签发完成前 HTTPS 暂不可用\n' "$MONKEYAI_DOMAIN" >&2
        ;;
    *) fail 'MONKEYAI_AUTO_TLS_ENABLED 只能为 true 或 false' ;;
esac

: > /tmp/nginx/preview-site.conf
if [ -n "${MONKEYAI_RUNTIME_PREVIEW_ORIGIN_TEMPLATE:-}" ]; then
    template=$MONKEYAI_RUNTIME_PREVIEW_ORIGIN_TEMPLATE
    case "$template" in
        'https://{artifact}.'*) MONKEYAI_PREVIEW_DOMAIN=${template#'https://{artifact}.'} ;;
        *) fail '预览 origin 必须为 https://{artifact}.独立域名' ;;
    esac
    validated=$(origin "https://$MONKEYAI_PREVIEW_DOMAIN") || fail '预览域名无效'
    [ "$validated" = "https://$MONKEYAI_PREVIEW_DOMAIN" ] || fail '预览模板只支持小写域名且不能包含端口'
    MONKEYAI_RUNTIME_PREVIEW_CERT_FILE=${MONKEYAI_RUNTIME_PREVIEW_CERT_FILE:-/run/secrets/preview/tls.crt}
    MONKEYAI_RUNTIME_PREVIEW_KEY_FILE=${MONKEYAI_RUNTIME_PREVIEW_KEY_FILE:-/run/secrets/preview/tls.key}
    for path in "$MONKEYAI_RUNTIME_PREVIEW_CERT_FILE" "$MONKEYAI_RUNTIME_PREVIEW_KEY_FILE"; do
        case "$path" in /*) ;; *) fail '预览证书必须使用绝对路径' ;; esac
        printf '%s\n' "$path" | LC_ALL=C awk 'NR != 1 || /[^A-Za-z0-9_.\/-]/ { exit 1 }' || fail '预览证书路径无效'
        [ -r "$path" ] || fail '预览证书或私钥不可读'
    done
    export MONKEYAI_PREVIEW_DOMAIN MONKEYAI_RUNTIME_PREVIEW_CERT_FILE MONKEYAI_RUNTIME_PREVIEW_KEY_FILE
    envsubst '${MONKEYAI_PREVIEW_DOMAIN} ${MONKEYAI_RUNTIME_PREVIEW_CERT_FILE} ${MONKEYAI_RUNTIME_PREVIEW_KEY_FILE}' \
        < /etc/nginx/monkeyai/preview.conf.template > /tmp/nginx/preview-site.conf
fi

nginx -t
exec "$@"
