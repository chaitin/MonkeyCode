package videogen

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
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

type outputFailure struct {
	phase    string
	expected int64
	received int64
	err      error
}

func (e *outputFailure) Error() string { return e.err.Error() }
func (e *outputFailure) Unwrap() error { return e.err }

func (s *Service) saveOutput(ctx context.Context, client *http.Client, jobID, address string, upstreamDurationMs int64) (_ VideoOutput, err error) {
	failure := outputFailure{phase: "download_response", expected: -1}
	defer func() {
		if err != nil {
			failure.err = err
			err = &failure
		}
	}()
	stream, expected, err := providerMedia(ctx, client, address)
	if err != nil {
		return VideoOutput{}, err
	}
	defer func() {
		if err := stream.Close(); err != nil {
			slog.Error("关闭资源失败", "module", "videogen", "operation", "saveOutput", "error", err)
		}
	}()
	failure.expected = expected
	failure.phase = "create_temp"
	file, err := os.CreateTemp("", "monkeyai-video-*.mp4")
	if err != nil {
		return VideoOutput{}, err
	}
	defer func() {
		if err := os.Remove(file.Name()); err != nil && !os.IsNotExist(err) {
			slog.Error("清理临时文件失败", "module", "videogen", "operation", "saveOutput", "error", err)
		}
	}()
	defer func() {
		if err := file.Close(); err != nil {
			slog.Error("关闭资源失败", "module", "videogen", "operation", "saveOutput", "error", err)
		}
	}()
	failure.phase = "download_body"
	count, err := io.Copy(file, io.LimitReader(stream, maxOutputBytes+1))
	failure.received = count
	if err != nil {
		return VideoOutput{}, err
	}
	if count > maxOutputBytes {
		return VideoOutput{}, errOutputTooLarge
	}
	if count < 1 {
		return VideoOutput{}, errOutputEmpty
	}
	if expected >= 0 && count != expected {
		return VideoOutput{}, errOutputIncomplete
	}
	failure.phase = "inspect_media"
	info, err := inspectMP4(file, count)
	if err != nil {
		slog.WarnContext(ctx, "操作失败", "module", "videogen", "operation", "saveOutput", "error", err)
		info = mediaInfo{DurationMs: upstreamDurationMs}
	}
	failure.phase = "hash_output"
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
	failure.phase = "store_object"
	storage, ok := s.storage.(streamStorage)
	if !ok {
		return VideoOutput{}, diagnosticError{code: "video_output_storage_unavailable", message: "视频对象存储未配置流式写入"}
	}
	key := fmt.Sprintf("video-outputs/%s/%s.mp4", jobID, hash)
	if err := storage.PutReader(ctx, key, file, count, "video/mp4"); err != nil {
		return VideoOutput{}, err
	}
	failure.phase = "insert_output"
	id := resource.ID()
	expiry := time.Now().Add(30 * 24 * time.Hour)
	err = sqlc.New(s.pool).InsertVideoOutput(ctx, sqlc.InsertVideoOutputParams{
		ID: id, JobID: jobID, ObjectKey: key, Width: int32(info.Width), Height: int32(info.Height),
		DurationMs: info.DurationMs, ByteSize: count, Sha256: hash, ExpiresAt: expiry,
	})
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := s.storage.Delete(cleanup, key); err != nil {
			slog.Error("清理存储对象失败", "module", "videogen", "operation", "saveOutput", "error", err)
		}
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
