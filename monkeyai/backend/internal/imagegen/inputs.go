package imagegen

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"time"

	_ "golang.org/x/image/webp"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

const maxInputBytes = 16 << 20
const maxInputPixels = 25_000_000

type Input struct {
	ID        string    `json:"file_id"`
	MIMEType  string    `json:"mime_type"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	ExpiresAt time.Time `json:"expires_at"`
	Data      []byte    `json:"-"`
}

type Inputs struct {
	repo    *Postgres
	storage resource.Storage
	now     func() time.Time
}

func NewInputs(repo *Postgres, storage resource.Storage) *Inputs {
	return &Inputs{repo: repo, storage: storage, now: time.Now}
}

func (s *Inputs) Upload(ctx context.Context, userID string, data []byte) (Input, error) {
	if userID == "" || len(data) == 0 || len(data) > maxInputBytes {
		return Input{}, resource.Invalid("参考图大小无效")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > maxInputPixels {
		return Input{}, resource.Invalid("参考图格式或像素数无效")
	}
	var mime string
	switch format {
	case "jpeg":
		mime = "image/jpeg"
	case "png":
		mime = "image/png"
	case "webp":
		mime = "image/webp"
	default:
		return Input{}, resource.Invalid("只支持 PNG、JPEG 或 WebP 参考图")
	}
	id := resource.ID()
	key := fmt.Sprintf("image-inputs/%s/%s.%s", userID, id, format)
	if err := s.storage.Put(ctx, key, data, mime); err != nil {
		return Input{}, err
	}
	digest := sha256.Sum256(data)
	expiry := s.now().Add(24 * time.Hour)
	err = sqlc.New(s.repo.pool).InsertImageInput(ctx, sqlc.InsertImageInputParams{
		ID: id, UserID: userID, ObjectKey: key,
		MimeType: mime, Width: int32(config.Width), Height: int32(config.Height),
		ByteSize: int64(len(data)), Sha256: hex.EncodeToString(digest[:]), ExpiresAt: expiry,
	})
	if err != nil {
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = s.storage.Delete(cleanupCtx, key)
		return Input{}, err
	}
	return Input{ID: id, MIMEType: mime, Width: config.Width, Height: config.Height, ExpiresAt: expiry}, nil
}

func (s *Inputs) Read(ctx context.Context, userID, fileID string) (Input, error) {
	row, err := sqlc.New(s.repo.pool).ImageInputOwned(ctx, sqlc.ImageInputOwnedParams{ID: fileID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Input{}, resource.NotFound
	}
	if err != nil {
		return Input{}, err
	}
	body, err := s.storage.Get(ctx, row.ObjectKey)
	if err != nil {
		return Input{}, err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, maxInputBytes+1))
	if err != nil {
		return Input{}, err
	}
	if len(data) > maxInputBytes {
		return Input{}, resource.Invalid("参考图超过大小限制")
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != row.Sha256 {
		return Input{}, errors.New("参考图内容校验失败")
	}
	return Input{ID: fileID, MIMEType: row.MimeType, Width: int(row.Width), Height: int(row.Height), Data: data}, nil
}
