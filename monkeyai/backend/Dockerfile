# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS builder

WORKDIR /src
ENV CGO_ENABLED=0
ENV GOPRIVATE=git.in.chaitin.net
RUN apk add --no-cache git openssh-client

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=secret,id=netrc,target=/root/.netrc \
    --mount=type=ssh \
    go mod download

COPY . .

ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=secret,id=netrc,target=/root/.netrc \
    --mount=type=ssh \
    GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/monkeyai-server ./cmd/server

FROM alpine:3.23

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 monkeyai \
    && adduser -S -D -u 10001 -G monkeyai monkeyai \
    && mkdir -p /app/runtime /app/import-tmp \
    && chown monkeyai:monkeyai /app/runtime /app/import-tmp \
    && chmod 700 /app/runtime /app/import-tmp

WORKDIR /app
ENV MONKEYAI_RUNTIME_STATE_DIR=/app/runtime

COPY --from=builder --chown=monkeyai:monkeyai /out/monkeyai-server ./monkeyai-server

USER monkeyai

EXPOSE 8080

CMD ["./monkeyai-server"]
