package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imageproxy"
)

type imageUploader struct{ inputs *imagegen.Inputs }

func (u imageUploader) Upload(ctx context.Context, userID string, data []byte) (imageproxy.InputFile, error) {
	input, err := u.inputs.Upload(ctx, userID, data)
	if err != nil {
		return imageproxy.InputFile{}, err
	}
	return imageproxy.InputFile{FileID: input.ID, MIMEType: input.MIMEType,
		Width: input.Width, Height: input.Height, ExpiresAt: input.ExpiresAt}, nil
}

func runImageCleanup(ctx context.Context, inputs *imagegen.Inputs) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		cleanupCtx, cancel := context.WithTimeout(ctx, time.Minute)
		_, err := inputs.Cleanup(cleanupCtx, 100)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("清理过期生图文件失败", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
