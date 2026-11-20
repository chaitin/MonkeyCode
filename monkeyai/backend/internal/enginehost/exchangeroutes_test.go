package enginehost

import (
	"github.com/go-chi/chi/v5"
	"testing"
)

func TestExchangeRequiresCommands(t *testing.T) {
	for _, installed := range []bool{false, true} {
		s := NewService(nil)
		if installed {
			s.WithCommands(&commandHandler{})
		}
		r := chi.NewRouter()
		s.Register(r)
		if r.Match(chi.NewRouteContext(), "POST", "/api/host/v1/exchange") != installed {
			t.Fatal("命令路由状态不正确")
		}
		if !r.Match(chi.NewRouteContext(), "POST", "/api/host/v1/heartbeat") {
			t.Fatal("心跳路由缺失")
		}
	}
}
