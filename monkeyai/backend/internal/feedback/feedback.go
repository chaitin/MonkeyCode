package feedback

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/feedback/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxContentRunes  = 5000
	maxVersionRunes  = 64
	maxIdempotency   = 128
	maxAttachments   = 3
	maxImageBytes    = 5 << 20
	maxRequestBytes  = 16 << 20
	maxImagePixels   = 25_000_000
	cleanupAge       = 24 * time.Hour
	cleanupBatchSize = 100
)

var categories = []string{"bug", "feature", "experience", "other"}
var platforms = []string{"desktop", "mobile", "web", "other"}
var states = []string{"uploading", "new", "resolved", "ignored", "failed"}
var patchStates = []string{"new", "resolved", "ignored"}

// Image 是已完成真实格式校验的上传图片。
type Image struct {
	Data     []byte
	Format   string
	MIMEType string
	ByteSize int64
	Width    int
	Height   int
	SHA256   string
}

type Request struct {
	Category       string
	Content        string
	Rating         *int32
	Platform       string
	ClientVersion  string
	RequestID      string
	IdempotencyKey string
	Images         []Image
}

type Feedback struct {
	ID            string       `json:"id"`
	UserID        string       `json:"user_id"`
	Category      string       `json:"category"`
	Content       string       `json:"content"`
	Rating        *int32       `json:"rating,omitempty"`
	Platform      string       `json:"platform"`
	ClientVersion string       `json:"client_version"`
	State         string       `json:"state"`
	RequestID     string       `json:"request_id,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
	Attachments   []Attachment `json:"attachments"`
}

type Attachment struct {
	ID           string    `json:"id"`
	FeedbackID   string    `json:"feedback_id"`
	MIMEType     string    `json:"mime_type"`
	ByteSize     int64     `json:"byte_size"`
	Width        int32     `json:"width"`
	Height       int32     `json:"height"`
	SHA256       string    `json:"sha256"`
	State        string    `json:"state"`
	Downloadable bool      `json:"downloadable"`
	CreatedAt    time.Time `json:"created_at"`
}

type Service struct {
	pool    *pgxpool.Pool
	storage resource.Storage
	now     func() time.Time
}

func NewService(pool *pgxpool.Pool, storage resource.Storage) *Service {
	return &Service{pool: pool, storage: storage, now: time.Now}
}

func (s *Service) Submit(ctx context.Context, userID string, in Request) (Feedback, bool, error) {
	if err := validateRequest(userID, in); err != nil {
		return Feedback{}, false, err
	}
	hash, err := requestHash(in)
	if err != nil {
		return Feedback{}, false, err
	}
	id := resource.ID()
	row, err := sqlc.New(s.pool).CreateFeedback(ctx, sqlc.CreateFeedbackParams{
		ID: id, UserID: userID, Category: in.Category, Content: in.Content, Rating: in.Rating,
		Platform: in.Platform, ClientVersion: in.ClientVersion, RequestID: in.RequestID,
		IdempotencyKey: in.IdempotencyKey, RequestHash: hash,
	})
	if errors.Is(err, pgx.ErrNoRows) && in.IdempotencyKey != "" {
		row, err = sqlc.New(s.pool).FeedbackByIdempotency(ctx, sqlc.FeedbackByIdempotencyParams{
			UserID: userID, IdempotencyKey: in.IdempotencyKey,
		})
		if err != nil {
			return Feedback{}, false, err
		}
		if row.RequestHash != hash {
			return Feedback{}, false, &resource.Error{Status: 409, Code: "idempotency_conflict", Message: "幂等键已用于其他反馈请求"}
		}
		switch row.State {
		case "uploading":
			return Feedback{}, false, &resource.Error{Status: 409, Code: "feedback_in_progress", Message: "反馈仍在处理中，请稍后重试"}
		case "failed":
			return Feedback{}, false, &resource.Error{Status: 500, Code: "feedback_failed", Message: "反馈处理失败，请稍后重试"}
		}
		out, err := s.read(ctx, row)
		return out, false, err
	}
	if err != nil {
		return Feedback{}, false, err
	}

	attachmentIDs := make([]string, 0, len(in.Images))
	objectKeys := make([]string, 0, len(in.Images))
	for _, image := range in.Images {
		attachmentID := resource.ID()
		key := fmt.Sprintf("feedback/%s/%s/%s.%s", userID, row.ID, attachmentID, image.Format)
		if err := sqlc.New(s.pool).CreateAttachment(ctx, sqlc.CreateAttachmentParams{
			ID: attachmentID, FeedbackID: row.ID, ObjectKey: key, MimeType: image.MIMEType,
			ByteSize: image.ByteSize, Width: int32(image.Width), Height: int32(image.Height), Sha256: image.SHA256,
		}); err != nil {
			return Feedback{}, true, s.fail(ctx, row.ID, attachmentIDs, objectKeys, err)
		}
		attachmentIDs = append(attachmentIDs, attachmentID)
		objectKeys = append(objectKeys, key)
		if err := s.storage.Put(ctx, key, image.Data, image.MIMEType); err != nil {
			return Feedback{}, true, s.fail(ctx, row.ID, attachmentIDs, objectKeys, storageFailure())
		}
		count, err := sqlc.New(s.pool).SetAttachmentReady(ctx, sqlc.SetAttachmentReadyParams{ID: attachmentID, FeedbackID: row.ID})
		if err != nil {
			return Feedback{}, true, s.fail(ctx, row.ID, attachmentIDs, objectKeys, err)
		}
		if count != 1 {
			return Feedback{}, true, s.fail(ctx, row.ID, attachmentIDs, objectKeys, errors.New("反馈附件状态更新失败"))
		}
	}
	if _, err := sqlc.New(s.pool).SetFeedbackState(ctx, sqlc.SetFeedbackStateParams{ID: row.ID, State: "new"}); err != nil {
		return Feedback{}, true, s.fail(ctx, row.ID, attachmentIDs, objectKeys, err)
	}
	row, err = sqlc.New(s.pool).FeedbackByID(ctx, row.ID)
	if err != nil {
		return Feedback{}, true, err
	}
	out, err := s.read(ctx, row)
	return out, true, err
}

func (s *Service) read(ctx context.Context, row sqlc.Feedback) (Feedback, error) {
	attachments, err := sqlc.New(s.pool).ListAttachments(ctx, row.ID)
	if err != nil {
		return Feedback{}, err
	}
	out := Feedback{
		ID: row.ID, UserID: row.UserID, Category: row.Category, Content: row.Content, Rating: row.Rating,
		Platform: row.Platform, ClientVersion: row.ClientVersion, State: row.State, RequestID: row.RequestID,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, Attachments: make([]Attachment, 0, len(attachments)),
	}
	for _, attachment := range attachments {
		out.Attachments = append(out.Attachments, publicAttachment(attachment, row.State))
	}
	return out, nil
}

func publicAttachment(row sqlc.FeedbackAttachment, feedbackState string) Attachment {
	return Attachment{
		ID: row.ID, FeedbackID: row.FeedbackID, MIMEType: row.MimeType, ByteSize: row.ByteSize,
		Width: row.Width, Height: row.Height, SHA256: row.Sha256, State: row.State,
		Downloadable: row.State == "ready" && feedbackState != "uploading" && feedbackState != "failed",
		CreatedAt:    row.CreatedAt,
	}
}

func (s *Service) fail(ctx context.Context, feedbackID string, attachmentIDs []string, objectKeys []string, cause error) error {
	for _, attachmentID := range attachmentIDs {
		if _, err := sqlc.New(s.pool).SetAttachmentFailed(ctx, sqlc.SetAttachmentFailedParams{ID: attachmentID, FeedbackID: feedbackID}); err != nil {
			slog.ErrorContext(ctx, "标记反馈附件失败", "feedback_id", feedbackID, "attachment_id", attachmentID, "error", err)
		}
	}
	if _, err := sqlc.New(s.pool).SetFeedbackState(ctx, sqlc.SetFeedbackStateParams{ID: feedbackID, State: "failed"}); err != nil {
		slog.ErrorContext(ctx, "标记反馈失败", "feedback_id", feedbackID, "error", err)
	}
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	for _, key := range objectKeys {
		if err := s.storage.Delete(cleanupCtx, key); err != nil {
			slog.WarnContext(ctx, "补偿删除反馈附件失败", "feedback_id", feedbackID, "error_type", fmt.Sprintf("%T", err))
		}
	}
	return cause
}

func validateRequest(userID string, in Request) error {
	if userID == "" || !slices.Contains(categories, in.Category) || !slices.Contains(platforms, in.Platform) {
		return resource.Invalid("反馈分类或平台无效")
	}
	if !utf8.ValidString(in.Content) || utf8.RuneCountInString(in.Content) > maxContentRunes {
		return resource.Invalid("反馈内容不能超过 5000 个字符")
	}
	if strings.TrimSpace(in.Content) == "" && len(in.Images) == 0 {
		return resource.Invalid("反馈内容和图片不能同时为空")
	}
	if utf8.RuneCountInString(in.ClientVersion) > maxVersionRunes {
		return resource.Invalid("客户端版本不能超过 64 个字符")
	}
	if utf8.RuneCountInString(in.IdempotencyKey) > maxIdempotency {
		return resource.Invalid("幂等键不能超过 128 个字符")
	}
	if in.Rating != nil && (*in.Rating < 1 || *in.Rating > 5) {
		return resource.Invalid("评分必须为 1 至 5")
	}
	if len(in.Images) > maxAttachments {
		return resource.Invalid("最多上传 3 张图片")
	}
	var total int64
	for _, image := range in.Images {
		if image.Format != "png" && image.Format != "jpeg" && image.Format != "webp" {
			return resource.Invalid("图片仅支持 PNG、JPEG 或 WebP")
		}
		if image.MIMEType != "image/"+image.Format || len(image.Data) == 0 || len(image.Data) > maxImageBytes {
			return resource.Invalid("图片大小或格式无效")
		}
		if image.Width <= 0 || image.Height <= 0 || int64(image.Width)*int64(image.Height) > maxImagePixels {
			return resource.Invalid("图片尺寸或像素数无效")
		}
		digest := sha256.Sum256(image.Data)
		if image.SHA256 != hex.EncodeToString(digest[:]) {
			return resource.Invalid("图片内容校验失败")
		}
		total += int64(len(image.Data))
	}
	if total > 15<<20 {
		return resource.Invalid("图片总大小不能超过 15 MiB")
	}
	return nil
}

func storageFailure() error {
	return errors.New("对象存储操作失败")
}

func errorType(err error) string {
	return fmt.Sprintf("%T", err)
}

func sha256Hex(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func requestHash(in Request) (string, error) {
	images := make([]string, 0, len(in.Images))
	for _, image := range in.Images {
		images = append(images, image.SHA256)
	}
	data, err := json.Marshal(struct {
		Category      string   `json:"category"`
		Content       string   `json:"content"`
		Rating        *int32   `json:"rating"`
		Platform      string   `json:"platform"`
		ClientVersion string   `json:"client_version"`
		Images        []string `json:"images"`
	}{in.Category, in.Content, in.Rating, in.Platform, in.ClientVersion, images})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:]), nil
}
