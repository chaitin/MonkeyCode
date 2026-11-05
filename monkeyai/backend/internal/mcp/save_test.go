package mcp

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseConnectorCredential(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		valid      bool
	}{
		{"omitted", `{"name":"connector"}`, true},
		{"header", `{"credential":{"name":"team","http_headers":{"Authorization":"header-secret"}}}`, true},
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
