.PHONY: build check linux

build:
	go build -trimpath -o bin/monkeyai-engine ./cmd/monkeyai-engine
	go build -trimpath -o bin/monkeyai-guest ./cmd/monkeyai-guest
	go build -trimpath -o bin/monkeyai-selftest ./cmd/monkeyai-selftest

check:
	go test ./...
	go vet ./...
	python3 -m unittest discover -s scripts -p 'test_*.py'

linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o bin/monkeyai-engine-linux-amd64 ./cmd/monkeyai-engine
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o bin/monkeyai-engine-linux-arm64 ./cmd/monkeyai-engine
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o bin/monkeyai-guest-linux-amd64 ./cmd/monkeyai-guest
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o bin/monkeyai-guest-linux-arm64 ./cmd/monkeyai-guest
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o bin/monkeyai-selftest-linux-amd64 ./cmd/monkeyai-selftest
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -o bin/monkeyai-selftest-linux-arm64 ./cmd/monkeyai-selftest
