package identity

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestSameOrigin(t *testing.T) {
	for _, tc := range []struct {
		name, origin, publicURL string
		valid                   bool
	}{
		{name: "完全一致", origin: "https://ai.example.com", publicURL: "https://ai.example.com", valid: true},
		{name: "浏览器省略 HTTPS 默认端口", origin: "https://ai.example.com", publicURL: "https://ai.example.com:443", valid: true},
		{name: "浏览器显式 HTTPS 默认端口", origin: "https://ai.example.com:443", publicURL: "https://ai.example.com", valid: true},
		{name: "浏览器省略 HTTP 默认端口", origin: "http://ai.example.com", publicURL: "http://ai.example.com:80", valid: true},
		{name: "主机名大小写不同", origin: "https://ai.example.com", publicURL: "https://AI.Example.COM", valid: true},
		{name: "公共地址带路径前缀", origin: "https://ai.example.com", publicURL: "https://ai.example.com/monkeyai", valid: true},
		{name: "IPv6 默认端口", origin: "https://[::1]", publicURL: "https://[::1]:443", valid: true},
		{name: "非默认端口不同", origin: "https://ai.example.com:8443", publicURL: "https://ai.example.com", valid: false},
		{name: "非默认端口一致", origin: "https://ai.example.com:8443", publicURL: "https://ai.example.com:8443", valid: true},
		{name: "协议不同", origin: "http://ai.example.com", publicURL: "https://ai.example.com", valid: false},
		{name: "主机不同", origin: "https://evil.example.com", publicURL: "https://ai.example.com", valid: false},
		{name: "子域不同", origin: "https://a.ai.example.com", publicURL: "https://ai.example.com", valid: false},
		{name: "null 来源", origin: "null", publicURL: "https://ai.example.com", valid: false},
		{name: "来源带路径", origin: "https://ai.example.com/path", publicURL: "https://ai.example.com", valid: false},
		{name: "来源带查询", origin: "https://ai.example.com?x=1", publicURL: "https://ai.example.com", valid: false},
		{name: "来源带用户信息", origin: "https://user@ai.example.com", publicURL: "https://ai.example.com", valid: false},
		{name: "公共地址无效", origin: "https://ai.example.com", publicURL: "://", valid: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameOrigin(tc.origin, tc.publicURL); got != tc.valid {
				t.Fatalf("sameOrigin(%q, %q) = %t, want %t", tc.origin, tc.publicURL, got, tc.valid)
			}
		})
	}
}

func TestReadApprovalAlwaysRequiresConsent(t *testing.T) {
	for _, scopes := range [][]string{nil, {}, {"session:read"}} {
		request := AuthorizationRequest{ID: "request-a", Scopes: scopes}
		cookie := &http.Cookie{Name: sessionCookie, Value: "browser-session"}
		template := httptest.NewRequest(http.MethodPost, "/complete", nil)
		template.AddCookie(cookie)
		csrf := consentToken(template, request.ID)
		for _, tc := range []struct {
			name, origin, csrf, body string
			cookie                   bool
			valid                    bool
		}{
			{name: "无确认"},
			{name: "缺少会话", csrf: csrf, body: `{"approved_scopes":[]}`},
			{name: "缺少 CSRF", cookie: true, body: `{"approved_scopes":[]}`},
			{name: "错误 CSRF", cookie: true, csrf: "wrong", body: `{"approved_scopes":[]}`},
			{name: "其他请求的 CSRF", cookie: true, csrf: consentToken(template, "request-b"), body: `{"approved_scopes":[]}`},
			{name: "跨源", cookie: true, csrf: csrf, origin: "https://evil.example.com", body: `{"approved_scopes":[]}`},
			{name: "缺少正文", cookie: true, csrf: csrf},
			{name: "缺少批准字段", cookie: true, csrf: csrf, body: `{}`},
			{name: "空批准字段", cookie: true, csrf: csrf, body: `{"approved_scopes":null}`},
			{name: "未知字段", cookie: true, csrf: csrf, body: `{"approved_scopes":[],"extra":true}`},
			{name: "多段正文", cookie: true, csrf: csrf, body: `{"approved_scopes":[]} {}`},
			{name: "明确批准空范围", cookie: true, csrf: csrf, origin: "https://ai.example.com", body: `{"approved_scopes":[]}`, valid: true},
		} {
			t.Run(tc.name+"/"+strings.Join(scopes, ","), func(t *testing.T) {
				r := httptest.NewRequest(http.MethodPost, "/complete", strings.NewReader(tc.body))
				if tc.cookie {
					r.AddCookie(cookie)
				}
				r.Header.Set("Origin", tc.origin)
				r.Header.Set("X-CSRF-Token", tc.csrf)
				approval, err := readApproval(httptest.NewRecorder(), r, request, "https://ai.example.com")
				if (err == nil) != tc.valid {
					t.Fatalf("approval=%v err=%v valid=%t", approval, err, tc.valid)
				}
				if tc.valid && (approval == nil || !slices.Equal(*approval, []string{})) {
					t.Fatalf("明确批准内容未保留: %v", approval)
				}
			})
		}
	}
}
