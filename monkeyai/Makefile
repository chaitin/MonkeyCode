PLATFORM ?= linux/amd64
TAG ?= $(shell git rev-parse --short HEAD)
REGISTRY ?= chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode

ADMIN_IMAGE ?= $(REGISTRY)/monkeyai-admin:$(TAG)
BACKEND_IMAGE ?= $(REGISTRY)/monkeyai-backend:$(TAG)
MIGRATE_IMAGE ?= $(REGISTRY)/monkeyai-migrate:$(TAG)
NGINX_ACME_IMAGE ?= $(REGISTRY)/nginx-acme:1.31.6-acme0.4.1-r1
PRIVATE_ROOT ?= ../..
MONKEYAI_PUBLIC_KEY_FILE ?=
MONKEYAI_AES_KEY_FILE ?=

.PHONY: image image-admin image-backend image-migrate image-nginx-acme push push-admin push-backend push-migrate push-nginx-acme images

image: image-admin image-backend image-migrate

image-admin:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(ADMIN_IMAGE) \
	  --build-arg NGINX_ACME_IMAGE=$(NGINX_ACME_IMAGE) \
	  --load \
	  ./admin
	@echo "Admin image: $(ADMIN_IMAGE)"

image-backend:
	@test -s "$(MONKEYAI_PUBLIC_KEY_FILE)" && test -s "$(MONKEYAI_AES_KEY_FILE)" || { echo "构建私有 Backend 需要 MONKEYAI_PUBLIC_KEY_FILE 和 MONKEYAI_AES_KEY_FILE" >&2; exit 1; }
	docker buildx build \
	  --platform $(PLATFORM) \
	  --file $(PRIVATE_ROOT)/monkeyai/Dockerfile \
	  --tag $(BACKEND_IMAGE) \
	  --build-arg VERSION=$(TAG) \
	  --secret "id=monkeyai_public_key,src=$(MONKEYAI_PUBLIC_KEY_FILE)" \
	  --secret "id=monkeyai_aes_key,src=$(MONKEYAI_AES_KEY_FILE)" \
	  --load \
	  $(PRIVATE_ROOT)
	@echo "Backend image: $(BACKEND_IMAGE)"

image-migrate:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(MIGRATE_IMAGE) \
	  --load \
	  ./backend/migrations
	@echo "Migrate image: $(MIGRATE_IMAGE)"

image-nginx-acme:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --file ./admin/Dockerfile.nginx-acme \
	  --tag $(NGINX_ACME_IMAGE) \
	  --load \
	  ./admin
	@echo "Nginx ACME image: $(NGINX_ACME_IMAGE)"

push: push-admin push-backend push-migrate

push-admin:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(ADMIN_IMAGE) \
	  --build-arg NGINX_ACME_IMAGE=$(NGINX_ACME_IMAGE) \
	  --push \
	  ./admin
	@echo "Pushed: $(ADMIN_IMAGE)"

push-backend:
	@test -s "$(MONKEYAI_PUBLIC_KEY_FILE)" && test -s "$(MONKEYAI_AES_KEY_FILE)" || { echo "发布私有 Backend 需要 MONKEYAI_PUBLIC_KEY_FILE 和 MONKEYAI_AES_KEY_FILE" >&2; exit 1; }
	docker buildx build \
	  --platform $(PLATFORM) \
	  --file $(PRIVATE_ROOT)/monkeyai/Dockerfile \
	  --tag $(BACKEND_IMAGE) \
	  --build-arg VERSION=$(TAG) \
	  --secret "id=monkeyai_public_key,src=$(MONKEYAI_PUBLIC_KEY_FILE)" \
	  --secret "id=monkeyai_aes_key,src=$(MONKEYAI_AES_KEY_FILE)" \
	  --push \
	  $(PRIVATE_ROOT)
	@echo "Pushed: $(BACKEND_IMAGE)"

push-migrate:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(MIGRATE_IMAGE) \
	  --push \
	  ./backend/migrations
	@echo "Pushed: $(MIGRATE_IMAGE)"

push-nginx-acme:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --file ./admin/Dockerfile.nginx-acme \
	  --tag $(NGINX_ACME_IMAGE) \
	  --push \
	  ./admin
	@echo "Pushed: $(NGINX_ACME_IMAGE)"

images:
	@echo "Admin: $(ADMIN_IMAGE)"
	@echo "Backend: $(BACKEND_IMAGE)"
	@echo "Migrate: $(MIGRATE_IMAGE)"
	@echo "Nginx ACME: $(NGINX_ACME_IMAGE)"
