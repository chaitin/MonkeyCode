PLATFORM=linux/amd64
TAG=$(shell git rev-parse --short HEAD)
OUTPUT=type=docker,dest=$(HOME)/tmp/mcai_server.tar
GOCACHE=/root/.cache/go-build
GOMODCACHE?=/go/pkg/mod
REGISTRY=chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode
INSTALLER_OUT=bin/installer
.PHONY: installer
# make server PLATFORM= TAG= OUTPUT_SERVER= GOCACHE=
image:
	docker buildx build \
	  -f build/Dockerfile \
	  --build-arg GOCACHE=${GOCACHE} \
	  --build-arg GOMODCACHE=${GOMODCACHE} \
	  --build-arg REPO_COMMIT=$(shell git rev-parse HEAD) \
	  --build-arg BUILD_TARGET=server \
	  --platform ${PLATFORM} \
	  --tag ${REGISTRY}/backend:${TAG} \
	  --secret id=netrc,src=${HOME}/.netrc \
	  --output ${OUTPUT} \
	  .
	  @echo Image: ${REGISTRY}/backend:${TAG}
	  @echo Tag: ${TAG}

# make ingress PLATFORM= TAG= OUTPUT_INGRESS=
ingress:
	docker buildx build \
	  -f build/Dockerfile.ingress \
	  --platform ${PLATFORM} \
	  --tag ${REGISTRY}/ingress:${TAG} \
	  --output ${OUTPUT} \
	  .
	  @echo Image: ${REGISTRY}/ingress:${TAG}
	  @echo Tag: ${TAG}

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

installer:
	mkdir -p ${INSTALLER_OUT}/x86_64 ${INSTALLER_OUT}/aarch64
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o ${INSTALLER_OUT}/x86_64/installer ./cmd/installer
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o ${INSTALLER_OUT}/aarch64/installer ./cmd/installer
	@echo Installer: ${INSTALLER_OUT}/x86_64/installer
	@echo Installer: ${INSTALLER_OUT}/aarch64/installer

.PHONY: offline-package
offline-package:
	ARCH=$${ARCH:-amd64} ./scripts/build-offline-package.sh
