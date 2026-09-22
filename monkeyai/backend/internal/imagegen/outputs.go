package imagegen

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"time"

	_ "golang.org/x/image/webp"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

const maxOutputBytes = 32 << 20

type Image struct {
	Data     []byte
	MIMEType string
	Width    int
	Height   int
}

type SavedOutput struct {
	ID        string
	MIMEType  string
	Width     int
	Height    int
	ExpiresAt time.Time
	PurgedAt  *time.Time
}

type Outputs struct {
	repo    *Postgres
	storage resource.Storage
	now     func() time.Time
}

func NewOutputs(repo *Postgres, storage resource.Storage) *Outputs {
	return &Outputs{repo: repo, storage: storage, now: time.Now}
}

func (s *Outputs) Save(ctx context.Context, jobID string, ordinal int32, img Image) (SavedOutput, error) {
	if jobID == "" || ordinal < 0 || len(img.Data) == 0 || len(img.Data) > maxOutputBytes {
		return SavedOutput{}, resource.Invalid("生成图片大小无效")
	}
	mime := http.DetectContentType(img.Data)
	extension := ""
	switch mime {
	case "image/png":
		extension = "png"
	case "image/jpeg":
		extension = "jpg"
	case "image/webp":
		extension = "webp"
	default:
		return SavedOutput{}, resource.Invalid("生成图片格式无效")
	}
	width, height := img.Width, img.Height
	config, _, err := image.DecodeConfig(bytes.NewReader(img.Data))
	if err != nil {
		return SavedOutput{}, resource.Invalid("生成图片无法解析")
	}
	if width > 0 && height > 0 && (width != config.Width || height != config.Height) {
		return SavedOutput{}, resource.Invalid("生成图片尺寸与响应不一致")
	}
	width, height = config.Width, config.Height
	if width < 1 || height < 1 || width > 8192 || height > 8192 || int64(width)*int64(height) > maxInputPixels {
		return SavedOutput{}, resource.Invalid("生成图片像素数无效")
	}
	digest := sha256.Sum256(img.Data)
	hash := hex.EncodeToString(digest[:])
	key := fmt.Sprintf("image-outputs/%s/%d-%s.%s", jobID, ordinal, hash, extension)
	if err := s.storage.Put(ctx, key, img.Data, mime); err != nil {
		return SavedOutput{}, err
	}
	id := resource.ID()
	expiry := s.now().Add(30 * 24 * time.Hour)
	count, err := sqlc.New(s.repo.pool).InsertImageOutput(ctx, sqlc.InsertImageOutputParams{
		ID: id, JobID: jobID, Ordinal: ordinal, ObjectKey: key, MimeType: mime,
		Width: int32(width), Height: int32(height), ByteSize: int64(len(img.Data)),
		Sha256: hash, ExpiresAt: expiry,
	})
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = s.storage.Delete(cleanupCtx, key)
		return SavedOutput{}, err
	}
	if count == 0 {
		existing, err := sqlc.New(s.repo.pool).OutputByOrdinal(ctx, sqlc.OutputByOrdinalParams{JobID: jobID, Ordinal: ordinal})
		if err != nil {
			return SavedOutput{}, err
		}
		if existing.Sha256 != hash {
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			_ = s.storage.Delete(cleanupCtx, key)
			return SavedOutput{}, errors.New("生成图片结果不一致")
		}
		id = existing.ID
	}
	return SavedOutput{ID: id, MIMEType: mime, Width: width, Height: height, ExpiresAt: expiry}, nil
}

func (s *Outputs) List(ctx context.Context, jobID string) ([]SavedOutput, error) {
	rows, err := sqlc.New(s.repo.pool).OutputsByJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	results := make([]SavedOutput, 0, len(rows))
	for _, row := range rows {
		results = append(results, SavedOutput{ID: row.ID, MIMEType: row.MimeType,
			Width: int(row.Width), Height: int(row.Height), ExpiresAt: row.ExpiresAt, PurgedAt: row.PurgedAt})
	}
	return results, nil
}

func (s *Outputs) Open(ctx context.Context, userID, outputID string) ([]byte, string, error) {
	row, err := sqlc.New(s.repo.pool).OutputOwned(ctx, sqlc.OutputOwnedParams{ID: outputID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", resource.NotFound
	}
	if err != nil {
		return nil, "", err
	}
	if row.ByteSize < 1 || row.ByteSize > maxOutputBytes {
		return nil, "", errors.New("生成图片大小无效")
	}
	body, err := s.storage.Get(ctx, row.ObjectKey)
	if err != nil {
		return nil, "", err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, maxOutputBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) != row.ByteSize {
		return nil, "", errors.New("生成图片内容大小不符")
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != row.Sha256 || http.DetectContentType(data) != row.MimeType {
		return nil, "", errors.New("生成图片内容校验失败")
	}
	return data, row.MimeType, nil
}
