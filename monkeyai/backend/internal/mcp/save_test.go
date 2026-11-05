package mcp

import (
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestResolveCredentialHeaders(t *testing.T) {
	old := resource.Object{"http_headers": map[string]any{"Authorization": "secret", "X-Key": "second"}}
	for _, tc := range []struct {
		name  string
		input map[string]string
		old   resource.Object
		want  map[string]string
	}{
		{"preserve and update", map[string]string{"authorization": "", "X-Key": "updated"}, old, map[string]string{"authorization": "secret", "X-Key": "updated"}},
		{"remove omitted header", map[string]string{"Authorization": ""}, old, map[string]string{"Authorization": "secret"}},
		{"add header", map[string]string{"Authorization": "", "X-New": "new"}, old, map[string]string{"Authorization": "secret", "X-New": "new"}},
		{"new credential", map[string]string{"Authorization": "new"}, nil, map[string]string{"Authorization": "new"}},
		{"new blank rejected", map[string]string{"Authorization": ""}, nil, nil},
		{"renamed blank rejected", map[string]string{"X-New": ""}, old, nil},
		{"oauth blank rejected", map[string]string{"Authorization": ""}, resource.Object{"http_headers": nil}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveCredentialHeaders(tc.input, tc.old)
			if (err != nil) != (tc.want == nil) || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("incorrect header preservation: err=%v", err)
			}
		})
	}
}

func TestParseConnectorCredential(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		valid      bool
	}{
		{"omitted", `{"name":"connector"}`, true},
		{"header", `{"credential":{"name":"team","http_headers":{"Authorization":"header-secret"}}}`, true},
		{"clear headers", `{"credential":{"id":"11111111-1111-4111-8111-111111111111","revision":1,"http_headers":{ }}}`, true},
		{"new empty header set", `{"credential":{"name":"team","http_headers":{}}}`, true},
		{"clear missing revision", `{"credential":{"id":"11111111-1111-4111-8111-111111111111","http_headers":{}}}`, false},
		{"headers array", `{"credential":{"name":"team","http_headers":[]}}`, false},
		{"oauth placeholder", `{"credential":{"name":"team"}}`, true},
		{"null", `{"credential":null}`, false},
		{"empty", `{"credential":{}}`, false},
		{"inject tokens", `{"credential":{"name":"team","oauth_access_token":"oauth-secret"}}`, false},
		{"missing revision", `{"credential":{"id":"11111111-1111-4111-8111-111111111111","name":"team"}}`, false},
		{"invalid revision", `{"credential":{"id":"11111111-1111-4111-8111-111111111111","revision":1.5,"name":"team"}}`, false},
		{"invalid id", `{"credential":{"id":"wrong","revision":1,"name":"team"}}`, false},
		{"revision without id", `{"credential":{"revision":1,"name":"team"}}`, false},
		{"null headers", `{"credential":{"name":"team","http_headers":null}}`, false},
		{"duplicate header", `{"credential":{"name":"team","http_headers":{"Authorization":"one","Authorization":"two"}}}`, false},
		{"case duplicate header", `{"credential":{"name":"team","http_headers":{"Authorization":"one","authorization":"two"}}}`, false},
		{"reserved header", `{"credential":{"name":"team","http_headers":{"Host":"wrong"}}}`, false},
		{"newline header", `{"credential":{"name":"team","http_headers":{"Authorization":"one\r\ntwo"}}}`, false},
		{"revoke", `{"credential":{"id":"11111111-1111-4111-8111-111111111111","revision":1,"revoke":true}}`, true},
		{"mixed revoke", `{"credential":{"id":"11111111-1111-4111-8111-111111111111","revision":1,"revoke":true,"name":"team"}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in, change, err := parseConnectorSave(httptest.NewRecorder(), httptest.NewRequest("POST", "/connectors", strings.NewReader(tc.body)))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
			if err == nil {
				if _, ok := in["credential"]; ok {
					t.Fatal("credential leaked into connector or package fields")
				}
				if tc.name != "omitted" && change == nil {
					t.Fatal("missing credential change")
				}
			}
		})
	}
}
