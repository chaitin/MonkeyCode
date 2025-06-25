PLATFORM=linux/amd64
TAG=main
OUTPUT=type=docker,dest=/tmp/monkeycode_server.tar
GOCACHE=$HOME/.cache/go-build
GOMODCACHE=$HOME/go/pkg/mod
REGISTRY=monkeycode.chaitin.cn/monkeycode

# make build PLATFORM= TAG= OUTPUT= GOCACHE=
image:
	docker buildx build \
	  -f build/Dockerfile \
	  --build-arg GOCACHE=${GOCACHE} \
	  --build-arg GOMODCACHE=${GOMODCACHE} \
	  --build-arg REPO_COMMIT=$(shell git rev-parse HEAD) \
	  --platform ${PLATFORM} \
	  --tag ${REGISTRY}/backend:${TAG} \
	  --output ${OUTPUT} \
	  .

image-nginx:
	docker buildx build \
	  -f build/Dockerfile.nginx \
	  --platform ${PLATFORM} \
	  --tag ${REGISTRY}/nginx:${TAG} \
	  --output ${OUTPUT} \
	  .

wire:
	wire cmd/server/wire.go cmd/server/main.go

swag:
	swag fmt -d internal && swag init --pd -g cmd/server/main.go -ot "json"

migrate_sql:
	migrate create -ext sql -dir migration -seq ${SEQ}