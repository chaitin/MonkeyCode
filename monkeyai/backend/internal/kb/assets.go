package kb

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

// ServeAsset requires an authenticated browser or agent identity supplied by the caller.
func (s *Service) ServeAsset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := identity.UserFromContext(ctx)
	id, name := chi.URLParam(r, "id"), chi.URLParam(r, "name")
	if !ok || !assetName.MatchString(name) || s.storage == nil {
		resource.Fail(ctx, w, resource.NotFound)
		return
	}
	book, err := resource.DecodeObject(sqlc.New(s.store.Pool).GetKbResource(ctx, id))
	if err != nil {
		resource.Fail(ctx, w, err)
		return
	}
	if user.Role != "admin" {
		permission, e := resolvePermissions(ctx, s.store.Pool, book, user.ID)
		if e != nil {
			resource.Fail(ctx, w, e)
			return
		}
		if !book.Bool("enabled") || !permission.CanRead {
			resource.Fail(ctx, w, resource.NotFound)
			return
		}
	}
	body, err := s.storage.Get(ctx, assetObjectKey(id, name))
	if err != nil {
		resource.Fail(ctx, w, resource.NotFound)
		return
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, (32<<20)+1))
	if err != nil {
		resource.Fail(ctx, w, err)
		return
	}
	mime := assetMIME(data)
	if len(data) > 32<<20 || mime == "" || !strings.HasPrefix(name, strings.TrimPrefix(importHash(data), "sha256:")+".") {
		resource.Fail(ctx, w, &resource.Error{Status: 502, Code: "storage_corrupted", Message: "知识库图片读取失败"})
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Recheck authorization for every request, including after a grant is revoked.
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = w.Write(data)
}
