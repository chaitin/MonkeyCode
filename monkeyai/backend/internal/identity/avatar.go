package identity

import (
	"bytes"
	"context"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	_ "golang.org/x/image/webp"
)

const maxAvatarBytes = 5 << 20

type ProfileStorage interface {
	Put(context.Context, string, []byte, string) error
	Get(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
}

func (s *Service) WithProfileStorage(storage ProfileStorage) *Service {
	s.avatars = storage
	return s
}

func avatarMIME(data []byte) (string, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return "", errors.New("请选择有效的 JPG、PNG 或 WebP 图片")
	}
	mime := map[string]string{"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[format]
	if mime == "" {
		return "", errors.New("请选择 JPG、PNG 或 WebP 图片")
	}
	if config.Width > 8192 || config.Height > 8192 || int64(config.Width)*int64(config.Height) > 25_000_000 {
		return "", errors.New("图片尺寸过大，请选择不超过 2500 万像素的头像")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return "", errors.New("图片内容不完整，请重新选择")
	}
	return mime, nil
}

func (s *Service) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	if !s.profileMutation(w, r) {
		return
	}
	if s.avatars == nil {
		writeError(r.Context(), w, 503, "storage_unavailable", "头像存储暂不可用")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxAvatarBytes))
	if err != nil {
		var oversized *http.MaxBytesError
		if errors.As(err, &oversized) {
			writeError(r.Context(), w, 413, "image_too_large", "图片大小不能超过 5 MB")
		} else {
			writeError(r.Context(), w, 400, "invalid_image", "读取图片失败")
		}
		return
	}
	mime, err := avatarMIME(data)
	if err != nil {
		writeError(r.Context(), w, 400, "invalid_image", err.Error())
		return
	}
	user, _ := UserFromContext(r.Context())
	ctx, cancel := profileContext(r)
	defer cancel()
	id := uuid.New().String()
	key := "user-avatars/" + user.ID + "/" + id
	avatarURL := s.publicURL + "/api/auth/v1/avatars/" + user.ID + "/" + id
	if err = s.avatars.Put(ctx, key, data, mime); err != nil {
		profileFailure(ctx, w, err)
		return
	}
	if !s.storeAvatar(ctx, w, user, avatarURL) {
		// Wait for the original user-row lock before inspecting its reference.
		// A plain read could see the old URL while an uncertain commit is still
		// in flight, causing us to delete the image it is about to publish.
		cleanup, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer stop()
		current, lookupErr := sqlc.New(s.db).LockStoredProfileAvatar(cleanup, user.ID)
		if lookupErr == nil && current != avatarURL || errors.Is(lookupErr, pgx.ErrNoRows) {
			s.removeAvatarObject(cleanup, user.ID, avatarURL)
		}
	}
}

func (s *Service) clearAvatar(w http.ResponseWriter, r *http.Request) {
	if !s.profileMutation(w, r) {
		return
	}
	user, _ := UserFromContext(r.Context())
	ctx, cancel := profileContext(r)
	defer cancel()
	s.storeAvatar(ctx, w, user, "")
}

func (s *Service) storeAvatar(ctx context.Context, w http.ResponseWriter, actor User, avatarURL string) bool {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		profileFailure(ctx, w, err)
		return false
	}
	defer rollbackProfile(ctx, tx)
	q := sqlc.New(tx)
	old, err := q.LockProfileAvatar(ctx, actor.ID)
	if err != nil {
		profileFailure(ctx, w, err)
		return false
	}
	updated, err := q.SetProfileAvatar(ctx, sqlc.SetProfileAvatarParams{ID: actor.ID, CustomAvatarUrl: avatarURL})
	if err == nil {
		err = audit.Write(ctx, tx, audit.Event{ActorID: actor.ID, Action: "avatar", Category: "identity", TargetType: "user", TargetID: actor.ID, Params: map[string]bool{"custom": avatarURL != ""}})
	}
	var user User
	if err == nil {
		user, err = readProfileUser(ctx, q, actor.ID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		profileFailure(ctx, w, err)
		return false
	}
	writeJSON(ctx, w, 200, map[string]any{"user": user, "custom_avatar_url": updated.CustomAvatarUrl})
	if old != "" && old != avatarURL {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		s.removeAvatarObject(cleanup, actor.ID, old)
	}
	return true
}

func (s *Service) avatarObject(userID, avatarURL string) string {
	parsed, err := url.Parse(avatarURL)
	if err != nil {
		return ""
	}
	base, err := url.Parse(s.publicURL)
	if err != nil {
		return ""
	}
	prefix := strings.TrimRight(base.Path, "/") + "/api/auth/v1/avatars/" + userID + "/"
	if !strings.HasPrefix(parsed.Path, prefix) {
		return ""
	}
	id := strings.TrimPrefix(parsed.Path, prefix)
	var uuid pgtype.UUID
	if uuid.Scan(id) != nil || !uuid.Valid {
		return ""
	}
	return "user-avatars/" + userID + "/" + id
}

func (s *Service) removeAvatarObject(ctx context.Context, userID, avatarURL string) {
	if s.avatars == nil {
		return
	}
	key := s.avatarObject(userID, avatarURL)
	if key == "" {
		return
	}
	if err := s.avatars.Delete(ctx, key); err != nil {
		logging.Event(ctx, slog.Default(), slog.LevelWarn, "identity.profile.failed", "清理旧头像失败", "user_id", userID, "error", err)
	}
}

func (s *Service) avatar(w http.ResponseWriter, r *http.Request) {
	userID, id := chi.URLParam(r, "userID"), chi.URLParam(r, "avatarID")
	for _, value := range []string{userID, id} {
		var uuid pgtype.UUID
		if uuid.Scan(value) != nil || !uuid.Valid {
			web.NotFound(w, r)
			return
		}
	}
	if s.avatars == nil {
		writeError(r.Context(), w, 503, "storage_unavailable", "头像存储暂不可用")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	current, err := sqlc.New(s.db).ReadProfileAvatar(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && s.avatarObject(userID, current) != "user-avatars/"+userID+"/"+id {
		web.NotFound(w, r)
		return
	}
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	body, err := s.avatars.Get(ctx, "user-avatars/"+userID+"/"+id)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	defer func() {
		if err := body.Close(); err != nil {
			logging.Diagnostic(ctx, slog.Default(), slog.LevelWarn, "identity.avatar.close.failed", err)
		}
	}()
	data, err := io.ReadAll(io.LimitReader(body, maxAvatarBytes+1))
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	if len(data) > maxAvatarBytes {
		profileFailure(ctx, w, errors.New("头像对象超出大小限制"))
		return
	}
	mime := http.DetectContentType(data)
	if mime != "image/jpeg" && mime != "image/png" && mime != "image/webp" {
		writeError(ctx, w, 500, "invalid_image", "头像内容无效")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=86400, immutable")
	w.Header().Set("ETag", `"`+id+`"`)
	http.ServeContent(w, r, "avatar", time.Time{}, bytes.NewReader(data))
}
