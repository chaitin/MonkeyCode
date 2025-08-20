PLATFORM=linux/amd64
TAG=main
REGISTRY=monkeycode.chaitin.cn/monkeycode
OUTPUT=type=docker,dest=${HOME}/tmp/monkeycode_frontend.tar

# 构建前端代码
build:
	pnpm run build

# 构建并加载到本地Docker
image: build
	docker buildx build \
	  -f .Dockerfile \
	  --platform ${PLATFORM} \
	  --tag ${REGISTRY}/frontend:${TAG} \
	  --output ${OUTPUT} \
	  .
