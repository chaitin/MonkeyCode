PLATFORM ?= linux/amd64
TAG ?= $(shell git rev-parse --short HEAD)
REGISTRY ?= chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode

ADMIN_IMAGE ?= $(REGISTRY)/monkeyai-admin:$(TAG)
BACKEND_IMAGE ?= $(REGISTRY)/monkeyai-backend:$(TAG)

.PHONY: image image-admin image-backend push push-admin push-backend images

image: image-admin image-backend

image-admin:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(ADMIN_IMAGE) \
	  --load \
	  ./admin
	@echo "Admin image: $(ADMIN_IMAGE)"

image-backend:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(BACKEND_IMAGE) \
	  --load \
	  ./backend
	@echo "Backend image: $(BACKEND_IMAGE)"

push: push-admin push-backend

push-admin:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(ADMIN_IMAGE) \
	  --push \
	  ./admin
	@echo "Pushed: $(ADMIN_IMAGE)"

push-backend:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(BACKEND_IMAGE) \
	  --push \
	  ./backend
	@echo "Pushed: $(BACKEND_IMAGE)"

images:
	@echo "Admin: $(ADMIN_IMAGE)"
	@echo "Backend: $(BACKEND_IMAGE)"
