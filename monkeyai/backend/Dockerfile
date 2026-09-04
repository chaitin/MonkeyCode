# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS builder

WORKDIR /src
ENV CGO_ENABLED=0

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .

ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build \
    GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /out/monkeyai-server ./cmd/server

FROM alpine:3.23

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S monkeyai \
    && adduser -S -G monkeyai monkeyai

WORKDIR /app

COPY --from=builder --chown=monkeyai:monkeyai /out/monkeyai-server ./monkeyai-server

USER monkeyai

EXPOSE 8080

CMD ["./monkeyai-server"]
