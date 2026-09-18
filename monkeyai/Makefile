PLATFORM ?= linux/amd64
TAG ?= $(shell git rev-parse --short HEAD)
REGISTRY ?= chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode

ADMIN_IMAGE ?= $(REGISTRY)/monkeyai-admin:$(TAG)
BACKEND_IMAGE ?= $(REGISTRY)/monkeyai-backend:$(TAG)
MIGRATE_IMAGE ?= $(REGISTRY)/monkeyai-migrate:$(TAG)
NGINX_ACME_IMAGE ?= $(REGISTRY)/nginx-acme:1.31.6-acme0.4.1-r1

.PHONY: image image-admin image-backend image-migrate image-nginx-acme push push-admin push-backend push-migrate push-nginx-acme images

image: image-admin image-backend image-migrate

image-admin:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(ADMIN_IMAGE) \
	  --build-arg NGINX_ACME_IMAGE=$(NGINX_ACME_IMAGE) \
	  --secret id=netrc,src=${HOME}/.netrc \
	  --load \
	  ./admin
	@echo "Admin image: $(ADMIN_IMAGE)"

image-backend:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(BACKEND_IMAGE) \
	  --secret id=netrc,src=${HOME}/.netrc \
	  --load \
	  ./backend
	@echo "Backend image: $(BACKEND_IMAGE)"

image-migrate:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(MIGRATE_IMAGE) \
	  --secret id=netrc,src=${HOME}/.netrc \
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
	  --secret id=netrc,src=${HOME}/.netrc \
	  --push \
	  ./admin
	@echo "Pushed: $(ADMIN_IMAGE)"

push-backend:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --tag $(BACKEND_IMAGE) \
	  --secret id=netrc,src=${HOME}/.netrc \
	  --push \
	  ./backend
	@echo "Pushed: $(BACKEND_IMAGE)"

push-migrate:
	docker buildx build \
	  --platform $(PLATFORM) \
	  --secret id=netrc,src=${HOME}/.netrc \
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
