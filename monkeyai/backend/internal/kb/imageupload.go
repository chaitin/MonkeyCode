package kb

import (
	"bytes"
	"context"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	_ "golang.org/x/image/webp"
)

const imageUploadLimit = 32 << 20

func readContentImage(data []byte) (string, string, error) {
	if len(data) == 0 || len(data) > imageUploadLimit {
		return "", "", resource.Invalid("图片不能为空且不能超过 32 MiB")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	ext := map[string]string{"png": "png", "jpeg": "jpg", "gif": "gif", "webp": "webp"}[format]
	if err != nil || ext == "" || config.Width <= 0 || config.Height <= 0 {
		return "", "", resource.Invalid("请选择有效的 PNG、JPEG、GIF 或 WebP 图片")
	}
	if int64(config.Width)*int64(config.Height) > 25_000_000 {
		return "", "", resource.Invalid("图片不能超过 2500 万像素")
	}
	if _, _, err = image.Decode(bytes.NewReader(data)); err != nil {
		return "", "", resource.Invalid("图片文件损坏")
	}
	return strings.TrimPrefix(imageHash(data), "sha256:") + "." + ext, assetMIME(data), nil
}

func (s *Service) uploadContentImage(w http.ResponseWriter, r *http.Request, admin bool) {
	ctx := r.Context()
	user, ok := identity.UserFromContext(ctx)
	if !ok || (admin && user.Role != "admin") {
		resource.Fail(ctx, w, resource.NotFound)
		return
	}
	result, err := s.storeContentImage(ctx, user.ID, chi.URLParam(r, "id"), admin, func() ([]byte, error) {
		r.Body = http.MaxBytesReader(w, r.Body, imageUploadLimit+(64<<10))
		parseErr := r.ParseMultipartForm(1 << 20)
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		if parseErr != nil || r.MultipartForm == nil {
			return nil, resource.Invalid("请通过 multipart/form-data 上传不超过 32 MiB 的图片")
		}
		files := r.MultipartForm.File["file"]
		if len(files) != 1 || len(r.MultipartForm.File) != 1 {
			return nil, resource.Invalid("请使用 file 字段上传一张图片")
		}
		if files[0].Size > imageUploadLimit {
			return nil, resource.Invalid("图片不能超过 32 MiB")
		}
		file, err := files[0].Open()
		if err != nil {
			return nil, err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, imageUploadLimit+1))
		if err != nil {
			return nil, err
		}
		return data, nil
	})
	if err != nil {
		resource.Fail(ctx, w, err)
		return
	}
	resource.JSON(ctx, w, http.StatusCreated, result)
}

// Read only after authorization, holding the KB lock through validation and storage.
func (s *Service) storeContentImage(ctx context.Context, actor, id string, admin bool, read func() ([]byte, error)) (resource.Object, error) {
	if actor == "" {
		return nil, resource.NotFound
	}
	if s.storage == nil {
		return nil, &resource.Error{Status: 503, Code: "storage_unavailable", Message: "知识库图片存储未配置"}
	}
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx, id)
	// Serialize permission checks and the object write with KB deletion and grant changes.
	book, err := resource.DecodeObject(sqlc.New(tx).LockKbResource(ctx, id))
	if err != nil {
		return nil, err
	}
	if admin {
		if book.String("ownership_type") != "system" {
			return nil, resource.Invalid("个人知识库在管理端仅支持读取")
		}
	} else if err = requireContentWrite(ctx, tx, id, actor); err != nil {
		return nil, err
	}
	if err = resource.RequireEditable(ctx, tx, "kb", id); err != nil {
		return nil, err
	}
	data, err := read()
	if err != nil {
		return nil, err
	}
	name, mime, err := readContentImage(data)
	if err != nil {
		return nil, err
	}
	if err = s.storage.Put(ctx, assetObjectKey(id, name), data, mime); err != nil {
		return nil, err
	}
	if err = resource.Audit(ctx, tx, actor, "kb", id, "upload_image"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	path := assetURL(id, name)
	return resource.Object{"name": name, "url": path, "mime_type": mime, "size_bytes": len(data), "markdown": "![](" + path + ")"}, nil
}
