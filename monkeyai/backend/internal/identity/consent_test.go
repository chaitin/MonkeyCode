package identity

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

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
