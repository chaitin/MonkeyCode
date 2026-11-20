package web

import (
	"context"
	core "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"net/http"
)

type Error = core.Error

func Message(ctx context.Context, code, source string) string { return core.Message(ctx, code, source) }
func Body(ctx context.Context, code, message string) map[string]any {
	return core.Body(ctx, code, message)
}
func NotFound(w http.ResponseWriter, r *http.Request) { core.NotFound(w, r) }
