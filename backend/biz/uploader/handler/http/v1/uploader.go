package v1

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/asseturl"
	"github.com/chaitin/MonkeyCode/backend/pkg/oss"
)

const defaultUploadMaxSize = 50 << 20

var allowedExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".ico": true, ".bmp": true,
	".pdf": true, ".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".ppt": true, ".pptx": true,
	".txt": true, ".md": true, ".markdown": true, ".csv": true, ".json": true, ".yaml": true, ".yml": true,
	".zip": true, ".tar": true, ".gz": true, ".tgz": true, ".rar": true, ".7z": true,
	".exe": true, ".dmg": true, ".deb": true, ".rpm": true,
}

type UploaderHandler struct {
	cfg    *config.Config
	logger *slog.Logger
	client *oss.Client
}

func NewUploaderHandler(i *do.Injector) (*UploaderHandler, error) {
	cfg := do.MustInvoke[*config.Config](i)
	if !cfg.ObjectStorage.Enabled {
		return &UploaderHandler{cfg: cfg}, nil
	}
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)
	logger := do.MustInvoke[*slog.Logger](i).With("module", "handler.uploader")
	opt := oss.S3Option{ForcePathStyle: cfg.ObjectStorage.ForcePathStyle, InitBucket: cfg.ObjectStorage.InitBucket}
	client, err := oss.NewS3Compatible(context.Background(), cfg.ObjectStorage, opt)
	if err != nil {
		return nil, err
	}
	h := &UploaderHandler{cfg: cfg, logger: logger, client: client}
	g := w.Group("/api/v1/uploader")
	g.Use(auth.Auth(), targetActive.TargetActive())
	g.POST("", web.BindHandler(h.Upload))
	g.POST("/presign", web.BindHandler(h.Presign))
	w.Group(asseturl.Path).GET("", web.BaseHandler(h.Asset), auth.Auth(), targetActive.TargetActive())
	return h, nil
}

func (h *UploaderHandler) Upload(c *web.Context, req domain.UploadReq) error {
	if h == nil || h.client == nil {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
	}
	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}
	if req.File == nil {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("file is required"))
	}
	maxSize := h.cfg.ObjectStorage.MaxSize
	if maxSize <= 0 {
		maxSize = defaultUploadMaxSize
	}
	if req.File.Size > maxSize {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("file exceeds limit"))
	}
	file, err := req.File.Open()
	if err != nil {
		return err
	}
	defer file.Close()
	fileData, err := io.ReadAll(io.LimitReader(file, maxSize+1))
	if err != nil {
		return err
	}
	if int64(len(fileData)) > maxSize {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("file exceeds limit"))
	}
	ext := strings.ToLower(filepath.Ext(req.File.Filename))
	if ext != "" && !allowedExtension(ext) {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("unsupported file extension"))
	}
	filename := fmt.Sprintf("%s_%s%s", user.ID.String(), fileMD5(fileData), ext)
	prefix, err := h.uploadPrefix(req.Usage)
	if err != nil {
		return err
	}
	client := h.requestClient(c.Request())
	if err := client.PutFile(c.Request().Context(), prefix, filename, bytes.NewReader(fileData)); err != nil {
		h.logger.With("error", err).ErrorContext(c.Request().Context(), "upload object failed")
		return err
	}
	return c.Success(assetAccessURL(prefix, filename))
}

func (h *UploaderHandler) Presign(c *web.Context, req domain.PresignReq) error {
	if h == nil || h.client == nil {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
	}
	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}
	filename, err := presignFilename(user.ID, req.Filename)
	if err != nil {
		return err
	}
	presign, err := h.requestClient(c.Request()).Presign(c.Request().Context(), h.cfg.ObjectStorage.TempPrefix, filename, parsePresignExpires(h.cfg.ObjectStorage.PresignExpires))
	if err != nil {
		h.logger.With("error", err).ErrorContext(c.Request().Context(), "presign object failed")
		return err
	}
	presign.UploadURL = uploadURLForRequest(presign.UploadURL, c.Request())
	presign.AccessURL = assetAccessURL(h.cfg.ObjectStorage.TempPrefix, filename)
	return c.Success(domain.PresignResp{UploadURL: presign.UploadURL, AccessURL: presign.AccessURL})
}

func (h *UploaderHandler) Asset(c *web.Context) error {
	if h == nil || h.client == nil {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
	}
	user := middleware.GetUser(c)
	if user == nil {
		return errcode.ErrUnauthorized
	}
	key, ok := asseturl.Parse(c.Request().URL.String())
	if !ok {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid asset key"))
	}
	if !asseturl.AllowedForUser(key, user.ID, h.cfg.ObjectStorage) {
		return errcode.ErrUnauthorized
	}
	rc, err := h.client.GetObject(c.Request().Context(), key)
	if err != nil {
		return err
	}
	defer rc.Close()
	contentType := mime.TypeByExtension(path.Ext(key))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Response().Header().Set("Content-Type", contentType)
	c.Response().Header().Set("Cache-Control", "private, max-age=3600")
	_, err = io.Copy(c.Response().Writer, rc)
	return err
}

func (h *UploaderHandler) requestClient(r *http.Request) *oss.Client {
	return h.client.WithAccessEndpoint(h.cfg.ObjectStorage.AccessEndpoint)
}

func assetAccessURL(prefix, filename string) string {
	return asseturl.Build(assetObjectKey(prefix, filename))
}

func assetObjectKey(prefix, filename string) string {
	cleanPrefix, _ := asseturl.CleanKey(prefix)
	name := path.Base(strings.Trim(filename, "/"))
	if name == "." || name == ".." || name == "/" {
		name = ""
	}
	key, _ := asseturl.CleanKey(path.Join(cleanPrefix, name))
	return key
}

func uploadURLForRequest(raw string, r *http.Request) string {
	if requestScheme(r) != "https" {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(u.Scheme, "http") {
		return raw
	}
	u.Scheme = "https"
	return u.String()
}

func requestScheme(r *http.Request) string {
	if r == nil {
		return ""
	}
	if proto := firstHeaderValue(r.Header.Get("X-Forwarded-Proto")); proto != "" {
		return strings.ToLower(proto)
	}
	if proto := forwardedProto(r.Header.Get("Forwarded")); proto != "" {
		return strings.ToLower(proto)
	}
	if r.TLS != nil {
		return "https"
	}
	if r.URL != nil {
		return strings.ToLower(r.URL.Scheme)
	}
	return ""
}

func firstHeaderValue(v string) string {
	if i := strings.Index(v, ","); i >= 0 {
		v = v[:i]
	}
	return strings.TrimSpace(v)
}

func forwardedProto(v string) string {
	v = firstHeaderValue(v)
	for _, part := range strings.Split(v, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok || !strings.EqualFold(key, "proto") {
			continue
		}
		return strings.Trim(strings.TrimSpace(value), `"`)
	}
	return ""
}

func (h *UploaderHandler) uploadPrefix(usage consts.UploadUsage) (string, error) {
	switch usage {
	case consts.UploadUsageAvatar:
		return h.cfg.ObjectStorage.AvatarPrefix, nil
	case consts.UploadUsageSpec:
		return h.cfg.ObjectStorage.SpecPrefix, nil
	case consts.UploadUsageRepo:
		return h.cfg.ObjectStorage.RepoPrefix, nil
	default:
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("unsupported upload usage"))
	}
}

func allowedExtension(ext string) bool {
	return allowedExtensions[strings.ToLower(ext)]
}

func presignFilename(userID uuid.UUID, original string) (string, error) {
	ext := strings.ToLower(filepath.Ext(original))
	hash := md5.Sum([]byte(original))
	return fmt.Sprintf("%s_%s%s", userID.String(), hex.EncodeToString(hash[:]), ext), nil
}

func fileMD5(fileb []byte) string {
	hash := md5.New()
	hash.Write(fileb)
	return hex.EncodeToString(hash.Sum(nil))
}

func parsePresignExpires(raw string) time.Duration {
	expires, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || expires <= 0 {
		return 7 * 24 * time.Hour
	}
	if expires > 7*24*time.Hour {
		return 7 * 24 * time.Hour
	}
	return expires
}
