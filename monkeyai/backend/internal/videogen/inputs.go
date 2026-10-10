package videogen

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
	"math/big"
	"regexp"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/videogen/sqlc"
	"github.com/jackc/pgx/v5"
)

const maxInputBytes = 10 << 20
const maxInputPixels = 25_000_000

var fileIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type InputFile struct {
	FileID    string    `json:"file_id"`
	MIMEType  string    `json:"mime_type"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Service) Upload(ctx context.Context, userID string, data []byte) (InputFile, error) {
	if userID == "" || len(data) < 1 || len(data) > maxInputBytes {
		return InputFile{}, resource.Invalid("视频参考图大小无效")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > maxInputPixels {
		return InputFile{}, resource.Invalid("视频参考图像素无效")
	}
	mime := ""
	switch format {
	case "png":
		mime = "image/png"
	case "jpeg":
		mime = "image/jpeg"
	default:
		return InputFile{}, resource.Invalid("只支持 PNG 或 JPEG 参考图")
	}
	id := resource.ID()
	key := fmt.Sprintf("video-inputs/%s/%s.%s", userID, id, format)
	if err := s.storage.Put(ctx, key, data, mime); err != nil {
		return InputFile{}, err
	}
	expiry := time.Now().Add(24 * time.Hour)
	digest := sha256.Sum256(data)
	err = sqlc.New(s.pool).InsertVideoInput(ctx, sqlc.InsertVideoInputParams{
		ID: id, UserID: userID, ObjectKey: key, MimeType: mime,
		Width: int32(config.Width), Height: int32(config.Height), ByteSize: int64(len(data)),
		Sha256: hex.EncodeToString(digest[:]), ExpiresAt: expiry,
	})
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = s.storage.Delete(cleanup, key)
		return InputFile{}, err
	}
	return InputFile{FileID: id, MIMEType: mime, Width: config.Width, Height: config.Height, ExpiresAt: expiry}, nil
}

func (s *Service) loadInput(ctx context.Context, userID string, ref Reference, spec model.VideoReferenceSpec) (Reference, error) {
	if !fileIDPattern.MatchString(ref.FileID) {
		return Reference{}, resource.Invalid("参考图 file_id 无效")
	}
	row, err := sqlc.New(s.pool).VideoInputOwned(ctx, sqlc.VideoInputOwnedParams{ID: ref.FileID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Reference{}, resource.NotFound
	}
	if err != nil {
		return Reference{}, err
	}
	if row.ByteSize < 1 || uint64(row.ByteSize) > spec.MaxBytes || !stringIn(spec.MIME, row.MimeType) || int(row.Width) < int(spec.MinWidth) ||
		spec.MaxWidth != 0 && row.Width > int32(spec.MaxWidth) || int(row.Height) < int(spec.MinHeight) ||
		spec.MaxHeight != 0 && row.Height > int32(spec.MaxHeight) {
		return Reference{}, resource.Invalid("参考图尺寸或格式不符合模型能力")
	}
	if spec.MinAspectRatio != "" || spec.MaxAspectRatio != "" {
		if !validImageRatio(int(row.Width), int(row.Height), spec.MinAspectRatio, spec.MaxAspectRatio) {
			return Reference{}, resource.Invalid("参考图宽高比超出模型能力")
		}
	}
	body, err := s.storage.Get(ctx, row.ObjectKey)
	if err != nil {
		return Reference{}, err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, maxInputBytes+1))
	if err != nil || len(data) != int(row.ByteSize) {
		return Reference{}, errors.New("参考图读取或大小校验失败")
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != row.Sha256 {
		return Reference{}, errors.New("参考图内容校验失败")
	}
	ref.Data, ref.MIMEType = data, row.MimeType
	return ref, nil
}

func validImageRatio(width, height int, minText, maxText string) bool {
	if height <= 0 {
		return false
	}
	ratio := new(big.Rat).SetFrac64(int64(width), int64(height))
	if minText != "" {
		min, ok := new(big.Rat).SetString(minText)
		if !ok || ratio.Cmp(min) < 0 {
			return false
		}
	}
	if maxText != "" {
		max, ok := new(big.Rat).SetString(maxText)
		if !ok || ratio.Cmp(max) > 0 {
			return false
		}
	}
	return true
}

func stringIn(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
