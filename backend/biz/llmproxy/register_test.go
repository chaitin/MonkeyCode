package llmproxy

import (
	"io"
	"log/slog"
	"testing"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
)

func TestNewHandlerRegistersProxyRoutes(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, newProxyTestDB(t))
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if _, err := NewHandler(injector); err != nil {
		t.Fatal(err)
	}

	want := map[string]bool{
		"POST /v1/chat/completions": false,
		"POST /v1/responses":        false,
		"POST /v1/messages":         false,
	}
	for _, route := range w.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for route, found := range want {
		if !found {
			t.Fatalf("route %s is not registered", route)
		}
	}

	_ = do.MustInvoke[*db.Client](injector)
}
