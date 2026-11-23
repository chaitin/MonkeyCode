package identity

import (
	"context"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/memberscope"
	"log/slog"
	"net/http"
	"time"
)

// MemberReads must be attached after RequireAdminOrGroupSupervisor. Resolve once per request,
// never from query parameters. The recursive query rechecks active supervisor assignments.
func (s *Service) MemberReads(get func(string, http.HandlerFunc)) memberscope.Get {
	return func(path string, h memberscope.Handler) {
		get(path, func(w http.ResponseWriter, r *http.Request) {
			scope, ok := s.employeeScope(w, r)
			if ok {
				h(w, r, scope)
			}
		})
	}
}
func (s *Service) employeeScope(w http.ResponseWriter, r *http.Request) (memberscope.Scope, bool) {
	user, ok := UserFromContext(r.Context())
	if !ok {
		writeError(r.Context(), w, 401, "unauthorized", "请先登录")
		return memberscope.Scope{}, false
	}
	if user.Role == "admin" {
		return memberscope.All(), true
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ids, err := sqlc.New(s.db).ManagedMemberIDs(ctx, user.ID)
	if err != nil {
		slog.ErrorContext(ctx, "读取主管成员范围失败", "error", err)
		writeError(r.Context(), w, 503, "service_unavailable", "暂时无法读取管辖范围")
		return memberscope.Scope{}, false
	}
	return memberscope.Managed(user.ID, ids), true
}
