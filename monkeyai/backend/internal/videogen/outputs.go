package videogen

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/videogen/sqlc"
	"github.com/jackc/pgx/v5"
)

const maxOutputBytes int64 = 256 << 20

type VideoOutput struct {
	FileID     string `json:"file_id"`
	URL        string `json:"url"`
	MIMEType   string `json:"mime_type"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int64  `json:"duration_ms"`
	ByteSize   int64  `json:"byte_size"`
}

type streamStorage interface {
	PutReader(context.Context, string, io.ReadSeeker, int64, string) error
}

func (s *Service) saveOutput(ctx context.Context, jobID, address string, upstreamDurationMs int64) (VideoOutput, error) {
	stream, expected, err := providerMedia(ctx, s.client, address)
	if err != nil {
		return VideoOutput{}, err
	}
	defer stream.Close()
	file, err := os.CreateTemp("", "monkeyai-video-*.mp4")
	if err != nil {
		return VideoOutput{}, err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	count, err := io.Copy(file, io.LimitReader(stream, maxOutputBytes+1))
	if err != nil || count < 1 || count > maxOutputBytes || expected >= 0 && count != expected {
		return VideoOutput{}, errors.New("生成视频超出大小限制或下载不完整")
	}
	info, err := inspectMP4(file, count)
	if err != nil || upstreamDurationMs > 0 && (info.DurationMs-upstreamDurationMs > 500 || upstreamDurationMs-info.DurationMs > 500) {
		return VideoOutput{}, errors.New("生成视频元数据与上游结果不一致")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return VideoOutput{}, err
	}
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return VideoOutput{}, err
	}
	hash := hex.EncodeToString(digest.Sum(nil))
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return VideoOutput{}, err
	}
	storage, ok := s.storage.(streamStorage)
	if !ok {
		return VideoOutput{}, errors.New("视频对象存储未配置流式写入")
	}
	key := fmt.Sprintf("video-outputs/%s/%s.mp4", jobID, hash)
	if err := storage.PutReader(ctx, key, file, count, "video/mp4"); err != nil {
		return VideoOutput{}, err
	}
	id := resource.ID()
	expiry := time.Now().Add(30 * 24 * time.Hour)
	err = sqlc.New(s.pool).InsertVideoOutput(ctx, sqlc.InsertVideoOutputParams{
		ID: id, JobID: jobID, ObjectKey: key, Width: int32(info.Width), Height: int32(info.Height),
		DurationMs: info.DurationMs, ByteSize: count, Sha256: hash, ExpiresAt: expiry,
	})
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = s.storage.Delete(cleanup, key)
		return VideoOutput{}, err
	}
	return VideoOutput{FileID: id, URL: "/v1/videos/outputs/" + id, MIMEType: "video/mp4", Width: info.Width, Height: info.Height,
		DurationMs: info.DurationMs, ByteSize: count}, nil
}

func (s *Service) OpenOutput(ctx context.Context, userID, outputID string) (io.ReadCloser, int64, string, error) {
	if !fileIDPattern.MatchString(outputID) {
		return nil, 0, "", resource.NotFound
	}
	row, err := sqlc.New(s.pool).VideoOutputOwned(ctx, sqlc.VideoOutputOwnedParams{ID: outputID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, "", resource.NotFound
	}
	if err != nil {
		return nil, 0, "", err
	}
	if row.ByteSize < 1 || row.ByteSize > maxOutputBytes || row.MimeType != "video/mp4" {
		return nil, 0, "", errors.New("生成视频文件元数据无效")
	}
	body, err := s.storage.Get(ctx, row.ObjectKey)
	if err != nil {
		return nil, 0, "", err
	}
	return body, row.ByteSize, row.MimeType, nil
}
