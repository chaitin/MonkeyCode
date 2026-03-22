.PHONY: build run test proto

build:
	go build -o bin/taskflow ./cmd/server

run:
	go run ./cmd/server

test:
	go test ./... -v

proto:
	protoc --go_out=. --go-grpc_out=. pkg/proto/taskflow.proto
