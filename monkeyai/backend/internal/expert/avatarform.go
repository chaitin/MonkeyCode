package expert

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	_ "golang.org/x/image/webp"
)

const avatarUploadLimit = 1 << 20
const avatarChangeKey = "_expert_avatar"

// Only the multipart parser can supply this value; JSON cannot choose an object key.
type avatarChange struct {
	data []byte
	mime string
	key  string
	old  string
}

func readAvatar(data []byte) (*avatarChange, error) {
	if len(data) > avatarUploadLimit {
		return nil, resource.InvalidCode("expert_avatar_too_large", "头像大小不能超过 1 MiB")
	}
	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	contentType := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}[format]
	if err != nil || contentType == "" {
		return nil, resource.InvalidCode("expert_avatar_invalid", "请选择有效的 PNG、JPG/JPEG 或 WebP 图片")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return nil, resource.InvalidCode("expert_avatar_invalid", "头像图片损坏")
	}
	return &avatarChange{data: data, mime: contentType}, nil
}

func parseExpertForm(w http.ResponseWriter, r *http.Request) (resource.Object, *avatarChange, error) {
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	var in resource.Object
	if mediaType != "multipart/form-data" {
		err := resource.Decode(w, r, &in)
		return in, nil, err
	}
	// Keep the existing 1 MiB metadata allowance, plus one 1 MiB image and framing.
	r.Body = http.MaxBytesReader(w, r.Body, 2*avatarUploadLimit+16384)
	if err := r.ParseMultipartForm(2 * avatarUploadLimit); err != nil {
		return nil, nil, resource.InvalidCode("expert_form_invalid", "专家表单无效或头像大小超过 1 MiB")
	}
	defer r.MultipartForm.RemoveAll()
	metadata := r.MultipartForm.Value["metadata"]
	if len(metadata) != 1 || len(metadata[0]) > 1<<20 || json.Unmarshal([]byte(metadata[0]), &in) != nil || in == nil {
		return nil, nil, resource.InvalidCode("expert_form_invalid", "专家 metadata 必须为 JSON 对象")
	}
	files := r.MultipartForm.File["avatar"]
	if len(files) != 1 {
		return nil, nil, resource.InvalidCode("expert_avatar_invalid", "请选择一张头像图片")
	}
	if files[0].Size > avatarUploadLimit {
		return nil, nil, resource.InvalidCode("expert_avatar_too_large", "头像大小不能超过 1 MiB")
	}
	file, err := files[0].Open()
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, avatarUploadLimit+1))
	if err != nil {
		return nil, nil, err
	}
	avatar, err := readAvatar(data)
	return in, avatar, err
}

func (s *Service) saveExpert(w http.ResponseWriter, r *http.Request) {
	in, avatar, err := parseExpertForm(w, r)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	user, _ := identity.UserFromContext(r.Context())
	out, err := s.saveWithAvatar(r.Context(), user.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), in, avatar)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.ETag(w, out)
	resource.JSON(r.Context(), w, http.StatusOK, out)
}

func (s *Service) saveWithAvatar(ctx context.Context, actor, id, match string, in resource.Object, avatar *avatarChange) (resource.Object, error) {
	delete(in, avatarChangeKey)
	if avatar != nil {
		if id != "" {
			imported, err := resource.Imported(ctx, s.Store.Pool, "expert", id)
			if err != nil {
				return nil, err
			}
			if imported {
				return nil, resource.ImportedReadOnly
			}
		}
		if s.storage == nil {
			return nil, &resource.Error{Status: 503, Code: "storage_unavailable", Message: "头像存储不可用"}
		}
		avatar.key = "experts/avatars/" + resource.ID()
		if err := s.storage.Put(ctx, avatar.key, avatar.data, avatar.mime); err != nil {
			s.discardUnusedAvatar(ctx, avatar.key)
			return nil, err
		}
		in[avatarChangeKey] = avatar
	}
	out, err := s.CRUD.Save(ctx, actor, id, match, in)
	if avatar != nil {
		if err != nil {
			s.discardUnusedAvatar(ctx, avatar.key)
		} else if avatar.old != "" {
			s.discardUnusedAvatar(ctx, avatar.old)
		}
	}
	return out, err
}

func (s *Service) discardUnusedAvatar(ctx context.Context, key string) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	// Save can commit before its final response read fails. Never delete a referenced
	// object, including an image shared by another (or soft-deleted) expert.
	referenced, err := sqlc.New(s.Store.Pool).AvatarReferenced(cleanup, key)
	if err != nil {
		slog.WarnContext(cleanup, "检查专家头像引用失败", "module", "expert", "error", err)
		return
	}
	if !referenced {
		if err := s.storage.Delete(cleanup, key); err != nil {
			slog.WarnContext(cleanup, "清理专家头像失败", "module", "expert", "error", err)
		}
	}
}
