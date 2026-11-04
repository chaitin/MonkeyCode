package setting

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

const logoUploadLimit = 1 << 20

type brandingStore interface {
	PutBrandingLogo(context.Context, string, string) (Record, error)
}
type brandingWriter interface {
	PutBranding(context.Context, string, string, string, string) (Record, error)
}

func (s *Service) WithLogoStorage(storage resource.Storage, publicURL string) *Service {
	s.logoStorage = storage
	s.publicURL = strings.TrimRight(publicURL, "/")
	return s
}
func (s *Service) logoKey(ctx context.Context) (string, error) {
	value, err := s.GetValue(ctx, "branding")
	if err != nil {
		return "", err
	}
	var branding struct {
		Key string `json:"logo_s3_key"`
	}
	if err := json.Unmarshal(value, &branding); err != nil {
		return "", err
	}
	if !strings.HasPrefix(branding.Key, "branding/logos/") {
		return "", nil
	}
	return branding.Key, nil
}
func (s *Service) BrandingLogoURL(ctx context.Context) (string, error) {
	key, err := s.logoKey(ctx)
	if err != nil || key == "" || s.logoStorage == nil {
		return "", err
	}
	return s.publicURL + "/api/auth/v1/branding/logo?v=" + resource.Hash(key), nil
}
func (s *Service) OpenBrandingLogo(ctx context.Context) (io.ReadCloser, string, error) {
	key, err := s.logoKey(ctx)
	if err != nil {
		return nil, "", err
	}
	if key == "" || s.logoStorage == nil {
		return nil, "", ErrNotFound
	}
	body, err := s.logoStorage.Get(ctx, key)
	return body, resource.Hash(key), err
}
func (s *Service) adminRecord(record Record) (Record, error) {
	var object map[string]any
	if err := json.Unmarshal(record.Value, &object); err != nil {
		return record, err
	}
	key, _ := object["logo_s3_key"].(string)
	value, err := redact(record.Key, record.Value)
	if err != nil {
		return record, err
	}
	record.Value = value
	if record.Key == "branding" {
		object = map[string]any{}
		if err := json.Unmarshal(value, &object); err != nil {
			return record, err
		}
		object["logo_url"] = ""
		if s.logoStorage != nil && strings.HasPrefix(key, "branding/logos/") {
			object["logo_url"] = s.publicURL + "/api/auth/v1/branding/logo?v=" + resource.Hash(key)
		}
		record.Value, err = json.Marshal(object)
	}
	return record, err
}
func (s *Service) logoRoutes(router chi.Router) {
	router.Put("/settings/branding/logo", s.uploadLogo)
	router.Delete("/settings/branding/logo", s.clearLogo)
}
func parseLogoForm(w http.ResponseWriter, r *http.Request) bool {
	r.Body = http.MaxBytesReader(w, r.Body, logoUploadLimit+4096)
	if err := r.ParseMultipartForm(logoUploadLimit); err != nil {
		settingError(r.Context(), w, 400, "Logo 图片大小不能超过 1 MiB")
		return false
	}
	return true
}
func (s *Service) readLogo(w http.ResponseWriter, r *http.Request) (string, bool) {
	if s.logoStorage == nil {
		settingError(r.Context(), w, 503, "图片存储不可用")
		return "", false
	}
	file, _, err := r.FormFile("logo")
	if err != nil {
		settingError(r.Context(), w, 400, "缺少 logo 文件")
		return "", false
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, logoUploadLimit+1))
	if err != nil || len(data) > logoUploadLimit {
		settingError(r.Context(), w, 400, "Logo 大小不能超过 1 MiB")
		return "", false
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 {
		settingError(r.Context(), w, 400, "请选择有效的 PNG、JPG/JPEG、WebP、GIF、BMP 或 TIFF 图片")
		return "", false
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		settingError(r.Context(), w, 400, "Logo 图片损坏")
		return "", false
	}
	var normalized bytes.Buffer
	if err := png.Encode(&normalized, decoded); err != nil {
		settingError(r.Context(), w, 400, "无法处理 Logo 图片")
		return "", false
	}
	key := "branding/logos/" + resource.ID() + ".png"
	if err := s.logoStorage.Put(r.Context(), key, normalized.Bytes(), "image/png"); err != nil {
		slog.ErrorContext(r.Context(), "保存品牌 Logo 失败", "error", err)
		settingError(r.Context(), w, 500, "保存 Logo 失败")
		return "", false
	}
	return key, true
}
func (s *Service) discardLogo(r *http.Request, key string) {
	if key == "" {
		return
	}
	if err := s.logoStorage.Delete(context.WithoutCancel(r.Context()), key); err != nil {
		slog.WarnContext(r.Context(), "清理未保存的 Logo 失败", "error", err)
	}
}
func (s *Service) uploadLogo(w http.ResponseWriter, r *http.Request) {
	if !parseLogoForm(w, r) {
		return
	}
	defer r.MultipartForm.RemoveAll()
	key, ok := s.readLogo(w, r)
	if !ok {
		return
	}
	if !s.saveLogo(w, r, key) {
		s.discardLogo(r, key)
	}
}
func (s *Service) clearLogo(w http.ResponseWriter, r *http.Request) { s.saveLogo(w, r, "") }
func (s *Service) saveLogo(w http.ResponseWriter, r *http.Request, key string) bool {
	store, ok := s.store.(brandingStore)
	if !ok {
		settingError(r.Context(), w, 503, "品牌图片存储不可用")
		return false
	}
	user, _ := identity.UserFromContext(r.Context())
	record, err := store.PutBrandingLogo(r.Context(), key, user.ID)
	if err != nil {
		slog.ErrorContext(r.Context(), "保存品牌设置失败", "error", err)
		settingError(r.Context(), w, 500, "保存 Logo 失败")
		return false
	}
	s.writeBranding(w, r, record)
	return true
}
func (s *Service) writeBranding(w http.ResponseWriter, r *http.Request, record Record) {
	record, err := s.adminRecord(record)
	if err != nil {
		settingError(r.Context(), w, 500, "读取品牌设置失败")
		return
	}
	settingJSON(r.Context(), w, 200, record)
}

// Save names and a staged logo together after the administrator clicks Save.
func (s *Service) saveBrandingForm(w http.ResponseWriter, r *http.Request) {
	if !parseLogoForm(w, r) {
		return
	}
	defer r.MultipartForm.RemoveAll()
	workspace := strings.TrimSpace(r.FormValue("workspace_name"))
	product := strings.TrimSpace(r.FormValue("product_name"))
	if workspace == "" || product == "" {
		settingError(r.Context(), w, 400, "团队名称和工具名称不能为空")
		return
	}
	action := r.FormValue("logo_action")
	if action != "replace" && action != "reset" {
		settingError(r.Context(), w, 400, "无效的 Logo 操作")
		return
	}
	store, ok := s.store.(brandingWriter)
	if !ok {
		settingError(r.Context(), w, 503, "品牌图片存储不可用")
		return
	}
	key := ""
	if action == "replace" {
		var ok bool
		key, ok = s.readLogo(w, r)
		if !ok {
			return
		}
	}
	user, _ := identity.UserFromContext(r.Context())
	record, err := store.PutBranding(r.Context(), workspace, product, key, user.ID)
	if err != nil {
		s.discardLogo(r, key)
		slog.ErrorContext(r.Context(), "保存品牌信息失败", "error", err)
		settingError(r.Context(), w, 500, "保存品牌信息失败")
		return
	}
	s.writeBranding(w, r, record)
}
