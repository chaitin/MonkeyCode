package kb

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) serveAvatar(w http.ResponseWriter, req *http.Request, admin bool) {
	ctx := req.Context()
	id := chi.URLParam(req, "id")
	kb, err := resource.DecodeObject(sqlc.New(s.store.Pool).GetKbResource(ctx, id))
	if err != nil {
		resource.Fail(req.Context(), w, err)
		return
	}
	if !admin {
		user, ok := identity.UserFromContext(ctx)
		if !ok {
			resource.Fail(req.Context(), w, resource.NotFound)
			return
		}
		permission, err := resolvePermissions(ctx, s.store.Pool, kb, user.ID)
		if err != nil {
			resource.Fail(req.Context(), w, err)
			return
		}
		if !permission.CanRead {
			resource.Fail(req.Context(), w, resource.NotFound)
			return
		}
	}
	key := kb.String("avatar_s3_key")
	if key == "" {
		resource.Fail(req.Context(), w, resource.NotFound)
		return
	}
	body, err := s.storage.Get(ctx, key)
	if err != nil {
		resource.Fail(req.Context(), w, err)
		return
	}
	defer func() {
		if err := body.Close(); err != nil {
			slog.Error("关闭资源失败", "module", "kb", "operation", "serveAvatar", "error", err)
		}
	}()
	data, err := io.ReadAll(io.LimitReader(body, 2<<20))
	if err != nil || len(data) >= 2<<20 {
		if err != nil {
			slog.WarnContext(req.Context(), "操作失败", "module", "kb", "operation", "serveAvatar", "error", err)
		}
		resource.Fail(req.Context(), w, &resource.Error{Status: 502, Code: "storage_corrupted", Message: "知识库图标读取失败"})
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(data))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if _, err := w.Write(data); err != nil {
		slog.Error("写入输出失败", "module", "kb", "operation", "serveAvatar", "error", err)
	}
}
