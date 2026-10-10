package feedback

import (
	"bytes"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	_ "golang.org/x/image/webp"
)

type AgentResponse struct {
	ID          string            `json:"id"`
	CreatedAt   time.Time         `json:"created_at"`
	Attachments []AgentAttachment `json:"attachments"`
}

type AgentAttachment struct {
	ID           string `json:"id"`
	MIMEType     string `json:"mime_type"`
	ByteSize     int64  `json:"byte_size"`
	Width        int32  `json:"width"`
	Height       int32  `json:"height"`
	Downloadable bool   `json:"downloadable"`
}

func agentResponse(in Feedback) AgentResponse {
	attachments := make([]AgentAttachment, 0, len(in.Attachments))
	for _, attachment := range in.Attachments {
		attachments = append(attachments, AgentAttachment{
			ID: attachment.ID, MIMEType: attachment.MIMEType, ByteSize: attachment.ByteSize,
			Width: attachment.Width, Height: attachment.Height, Downloadable: attachment.Downloadable,
		})
	}
	return AgentResponse{ID: in.ID, CreatedAt: in.CreatedAt, Attachments: attachments}
}

func (s *Service) RegisterAgent(router chi.Router) {
	router.Post("/feedback", s.create)
}

func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	parseErr := r.ParseMultipartForm(1 << 20)
	if r.MultipartForm != nil {
		defer func() {
			if err := r.MultipartForm.RemoveAll(); err != nil {
				slog.WarnContext(r.Context(), "清理反馈上传临时文件失败", "error", err)
			}
		}()
	}
	if parseErr != nil {
		resource.Fail(w, resource.Invalid("反馈请求无效或超过 16 MiB"))
		return
	}

	rating, err := parseRating(r.FormValue("rating"))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	files := r.MultipartForm.File["images"]
	if len(files) > maxAttachments {
		resource.Fail(w, resource.Invalid("最多上传 3 张图片"))
		return
	}
	images := make([]Image, 0, len(files))
	for _, header := range files {
		image, err := readImage(header)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		images = append(images, image)
	}

	user, _ := identity.UserFromContext(r.Context())
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	platform := strings.TrimSpace(r.FormValue("platform"))
	if platform == "" {
		platform = "other"
	}
	out, created, err := s.Submit(r.Context(), user.ID, Request{
		Category: strings.TrimSpace(r.FormValue("category")), Content: r.FormValue("content"), Rating: rating,
		Platform: platform, ClientVersion: r.FormValue("client_version"),
		RequestID: middleware.GetReqID(r.Context()), IdempotencyKey: idempotencyKey, Images: images,
	})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	resource.JSON(w, status, agentResponse(out))
}

func parseRating(value string) (*int32, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	n, err := strconv.ParseInt(value, 10, 32)
	if err != nil || n < 1 || n > 5 {
		return nil, resource.Invalid("评分必须为 1 至 5")
	}
	rating := int32(n)
	return &rating, nil
}

func readImage(header *multipart.FileHeader) (Image, error) {
	if header.Size > maxImageBytes {
		return Image{}, resource.Invalid("单张图片不能超过 5 MiB")
	}
	file, err := header.Open()
	if err != nil {
		return Image{}, resource.Invalid("读取图片失败")
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(io.LimitReader(file, maxImageBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxImageBytes {
		return Image{}, resource.Invalid("单张图片不能超过 5 MiB")
	}
	return decodeImage(data)
}

func decodeImage(data []byte) (Image, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxImagePixels {
		return Image{}, resource.Invalid("图片格式、尺寸或像素数无效")
	}
	decoded, format, err := image.Decode(bytes.NewReader(data))
	if err != nil || decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return Image{}, resource.Invalid("图片内容无效")
	}
	if format != "png" && format != "jpeg" && format != "webp" {
		return Image{}, resource.Invalid("图片仅支持 PNG、JPEG 或 WebP")
	}
	mimeType := "image/" + format
	return Image{Data: data, Format: format, MIMEType: mimeType, ByteSize: int64(len(data)), Width: config.Width, Height: config.Height, SHA256: sha256Hex(data)}, nil
}
