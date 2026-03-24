PLATFORM=linux/amd64
TAG=$(shell git rev-parse --short HEAD)
OUTPUT=type=docker,dest=$(HOME)/tmp/mcai_server.tar
GOCACHE=/root/.cache/go-build
GOMODCACHE?=/go/pkg/mod
REGISTRY=chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode

# make server PLATFORM= TAG= OUTPUT_SERVER= GOCACHE=
image:
	docker buildx build \
	  -f build/Dockerfile \
	  --build-arg GOCACHE=${GOCACHE} \
	  --build-arg GOMODCACHE=${GOMODCACHE} \
	  --build-arg REPO_COMMIT=$(shell git rev-parse HEAD) \
	  --build-arg BUILD_TARGET=server \
	  --platform ${PLATFORM} \
	  --tag ${REGISTRY}/monkeycode-ai-backend:${TAG} \
	  --secret id=netrc,src=${HOME}/.netrc \
	  --output ${OUTPUT} \
	  .

# make ingress PLATFORM= TAG= OUTPUT_INGRESS=
ingress:
	docker buildx build \
	  -f build/Dockerfile.ingress \
	  --platform ${PLATFORM} \
	  --tag ${REGISTRY}/monkeycode-ai-ingress:${TAG} \
	  --output ${OUTPUT} \
	  .

swag:
	swag fmt && swag init -ot json --pd -g cmd/server/main.go

generate:
	go generate ./ent

check-generate:
	@echo "Checking if generated code is up to date..."
	@go generate ./ent
	@git diff --quiet dbv2/ || (echo "Error: Generated code out of sync with schema. Run 'make generate' and commit the changes." && exit 1)
	@echo "Generated code is up to date."

migrate_sql:
	migrate create -ext sql -dir migration -seq ${SEQ}
