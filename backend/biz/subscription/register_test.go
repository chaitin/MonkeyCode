package subscription

import (
	"io"
	"log/slog"
	"testing"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func TestNewHandlerRegistersSubscriptionRoute(t *testing.T) {
	injector := do.New()
	w := web.New()
	do.ProvideValue(injector, w)
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue(injector, &middleware.AuthMiddleware{})
	do.ProvideValue(injector, middleware.NewTargetActiveMiddleware(slog.New(slog.NewTextHandler(io.Discard, nil)), nil))

	ProvideSubscription(injector)
	InvokeSubscription(injector)

	if !hasRoute(w, "GET", "/api/v1/users/subscription") {
		t.Fatal("GET /api/v1/users/subscription route is not registered")
	}
	if hasRoute(w, "POST", "/api/v1/users/subscription") {
		t.Fatal("POST /api/v1/users/subscription should not be registered in opensource")
	}
}

func hasRoute(w *web.Web, method, path string) bool {
	for _, route := range w.Routes() {
		if route.Method == method && route.Path == path {
			return true
		}
	}
	return false
}
