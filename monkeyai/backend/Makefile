.PHONY: build check fmt run test

build:
	go build -o bin/monkeyai-server ./cmd/server

check: test
	go vet ./...

fmt:
	go fmt ./...

run:
	go run ./cmd/server

test:
	go test ./...
