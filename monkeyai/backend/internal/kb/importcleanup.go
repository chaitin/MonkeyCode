package kb

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
)

// CleanupImports removes only expired original objects no document references.
// Tokens last 24h; the 48h cutoff leaves an extra day for in-flight requests.
func (s *Service) CleanupImports(ctx context.Context) error {
	return s.cleanupImports(ctx, new(string))
}

func (s *Service) cleanupImports(ctx context.Context, after *string) error {
	storage, ok := s.storage.(interface {
		WalkOriginals(context.Context, time.Time, *string, func(string) error) error
	})
	if !ok {
		return nil
	}
	return storage.WalkOriginals(ctx, time.Now().Add(-48*time.Hour), after, func(key string) error {
		parts := strings.Split(key, "/")
		if len(parts) != 5 || parts[0] != "knowledge" || parts[2] != "imports" || !strings.HasPrefix(parts[4], "original.") {
			return nil
		}
		exists, e := sqlc.New(s.store.Pool).KbOriginalReferenced(ctx, key)
		if e != nil {
			return e
		}
		if exists {
			return nil
		}
		return s.storage.Delete(ctx, key)
	})
}

func (s *Service) runImportCleanup(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	var after string
	for {
		run, cancel := context.WithTimeout(ctx, 10*time.Minute)
		err := s.cleanupImports(run, &after)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.WarnContext(ctx, "知识库过期原件清理失败", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
