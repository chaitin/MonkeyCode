package identity

import (
	"context"
	"net/http"
	"slices"
	"strings"
)

const Audience = "monkeyai-api"

var scopeNames = map[string]string{
	"environment:read":   "读取自己的云环境",
	"environment:manage": "创建和管理自己的云环境",
	"device:bind":        "确认本机设备身份",
	"device:publish":     "发布本机远程执行服务",
	"device:connect":     "连接自己的执行设备",
	"device:manage":      "管理自己的远程执行登记",
	"session:report":     "上报本机会话统计",
	"session:read":       "读取目标设备会话",
	"session:control":    "创建和控制目标设备会话",
	"files:read":         "读取获准文件",
	"files:write":        "上传文件到目标设备",
	"resources:manage":   "管理目标设备资源配置",
}

type Principal struct {
	UserID            string
	ClientID          string
	GrantID           string
	Scopes            []string
	Audience          string
	Purpose           string
	MachineID         string
	KeyID             string
	RevocationVersion int64
}

type principalKey struct{}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(Principal)
	p.Scopes = slices.Clone(p.Scopes)
	return p, ok
}

func (p Principal) Has(scope string) bool {
	return p.Audience == Audience && slices.Contains(p.Scopes, scope)
}

func RequireScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := PrincipalFromContext(r.Context())
			if !ok || !p.Has(scope) {
				writeError(r.Context(), w, http.StatusForbidden, "permission_denied", "授权不包含所需权限")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func parseScopes(clientID, value string) ([]string, error) {
	if len(value) > 1024 {
		return nil, oauthError("invalid_scope", "权限列表过长")
	}
	scopes := strings.Fields(value)
	if value != "" && len(scopes) == 0 {
		return nil, oauthError("invalid_scope", "权限列表不能仅包含空白字符")
	}
	for _, scope := range scopes {
		if _, ok := scopeNames[scope]; !ok {
			return nil, oauthError("invalid_scope", "不支持请求的权限")
		}
		if clientID == RuntimeClientID && !slices.Contains(runtimeScopes, scope) {
			return nil, oauthError("invalid_scope", "独立执行授权仅限本设备执行和上报")
		}
		if clientID == "monkeyai-mobile" && slices.Contains([]string{"device:bind", "device:publish", "session:report"}, scope) {
			return nil, oauthError("invalid_scope", "此客户端不能发布执行设备")
		}
	}
	slices.Sort(scopes)
	return slices.Compact(scopes), nil
}

func approvedScopes(requested, approved []string) ([]string, error) {
	for _, scope := range approved {
		if !slices.Contains(requested, scope) {
			return nil, oauthError("invalid_scope", "批准权限不能超过申请范围")
		}
	}
	out := slices.Clone(approved)
	slices.Sort(out)
	if out == nil {
		out = []string{}
	}
	return slices.Compact(out), nil
}
