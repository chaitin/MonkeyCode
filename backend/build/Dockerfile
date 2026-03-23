FROM --platform=$BUILDPLATFORM golang:1.25.8-alpine3.23 AS builder

WORKDIR /src
ENV CGO_ENABLED=0

COPY go.mod go.sum ./

ARG GOMODCACHE
RUN --mount=type=cache,target=${GOMODCACHE} \
    go mod download

ARG TARGETOS TARGETARCH GOCACHE
RUN --mount=type=bind,target=. \
--mount=type=cache,target=${GOMODCACHE} \
--mount=type=cache,target=${GOCACHE} \
GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/main cmd/server/main.go

FROM alpine:3.23 AS binary

# Install tzdata for timezone support
RUN apk add --no-cache tzdata

WORKDIR /app

# Copy migration files
COPY migration ./migration

COPY --from=builder /out/main /app/main

# Expose the port the app runs on
EXPOSE 8888

# Set timezone to Asia/Shanghai
ENV TZ=Asia/Shanghai

CMD [ "./main" ]