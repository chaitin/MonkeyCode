SQLC_VERSION := v1.30.0
SQLC ?= go run github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)

.PHONY: build check fmt generate sqlc-check run test

build:
	go build -o bin/monkeyai-server ./cmd/server

check: sqlc-check test
	go vet ./...

generate:
	go run ./tools/sqlcschema
	$(SQLC) generate

sqlc-check:
	go run ./tools/sqlcschema -check
	$(SQLC) diff

fmt:
	go fmt ./...

run:
	go run ./cmd/server

test:
	go test ./...
