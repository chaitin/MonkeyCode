package mcp

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
)

func (s *Service) WithStorage(storage resource.Storage) *Service { s.storage = storage; return s }
func (s *Service) iconRoutes(r chi.Router, admin bool) {
	if s.storage == nil {
		return
	}
	if admin {
		r.Put("/connector-providers/{id}/icon", func(w http.ResponseWriter, r *http.Request) { s.uploadIcon(w, r, true) })
		r.Get("/connector-providers/{id}/icon", func(w http.ResponseWriter, r *http.Request) { s.icon(w, r, chi.URLParam(r, "id")) })
	} else {
		r.Put("/connector-providers/{id}/icon", func(w http.ResponseWriter, r *http.Request) { s.uploadIcon(w, r, false) })
		r.Get("/connector-providers/{id}/icon", func(w http.ResponseWriter, r *http.Request) {
			u, _ := identity.UserFromContext(r.Context())
			id := chi.URLParam(r, "id")
			if _, err := s.userProvider(r.Context(), s.Store.Pool, id, u.ID); err != nil {
				resource.Fail(w, err)
				return
			}
			s.icon(w, r, id)
		})
		r.Get("/connectors/{id}/icon", func(w http.ResponseWriter, r *http.Request) {
			u, _ := identity.UserFromContext(r.Context())
			c, err := s.Connector(r.Context(), s.Store.Pool, chi.URLParam(r, "id"), u.ID, false)
			if err != nil {
				resource.Fail(w, err)
				return
			}
			s.icon(w, r, c.String("provider_id"))
		})
	}
}
func (s *Service) uploadIcon(w http.ResponseWriter, r *http.Request, admin bool) {
	r.Body = http.MaxBytesReader(w, r.Body, (1<<20)+4096)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		resource.Fail(w, resource.Invalid("图标必须小于 1 MiB"))
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, err := r.FormFile("icon")
	if err != nil {
		resource.Fail(w, resource.Invalid("缺少 icon 文件"))
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		resource.Fail(w, resource.Invalid("图标超限"))
		return
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") || config.Width > 4096 || config.Height > 4096 {
		resource.Fail(w, resource.Invalid("图标仅支持不超过 4096 × 4096 的 PNG/JPEG"))
		return
	}
	ctx := r.Context()
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(ctx)
	id := chi.URLParam(r, "id")
	u, _ := identity.UserFromContext(ctx)
	user := u.ID
	if admin {
		user = ""
	}
	p, err := resource.DecodeObject(sqlc.New(tx).LockIconProvider(ctx, sqlc.LockIconProviderParams{ID: id, UserID: user}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if r.Header.Get("If-Match") == "" {
		resource.Fail(w, &resource.Error{Status: http.StatusPreconditionRequired, Code: "precondition_required", Message: "更新需要 If-Match"})
		return
	}
	if r.Header.Get("If-Match") != fmt.Sprintf(`"%v"`, p["revision"]) {
		resource.Fail(w, resource.Conflict)
		return
	}
	key := "connector-icons/" + id + "/" + resource.ID() + "/icon." + format
	if err = s.storage.Put(ctx, key, data, "image/"+format); err == nil {
		_, err = sqlc.New(tx).SetProviderIcon(ctx, sqlc.SetProviderIconParams{ID: id, IconS3Key: key})
	}
	if err == nil {
		err = resource.Audit(ctx, tx, u.ID, "provider", id, "icon")
	}

	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}

	if admin {
		p, err = s.Providers.Get(ctx, s.Store.Pool, id)
	} else {
		p, err = s.Providers.GetUser(ctx, s.Store.Pool, id, u.ID)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.ETag(w, p)
	resource.JSON(w, 200, p)
}
func (s *Service) icon(w http.ResponseWriter, r *http.Request, provider string) {
	key, err := sqlc.New(s.Store.Pool).GetProviderIcon(r.Context(), provider)
	if err != nil || key == "" {
		resource.Fail(w, resource.NotFound)
		return
	}

	body, err := s.storage.Get(r.Context(), key)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer body.Close()
	mime := "image/png"
	if strings.HasSuffix(key, ".jpeg") {
		mime = "image/jpeg"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", `"`+resource.Hash(key)+`"`)
	_, _ = io.Copy(w, body)
}
