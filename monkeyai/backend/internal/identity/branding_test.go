package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPublicBranding(t *testing.T) {
	for _, test := range []struct {
		name     string
		settings SettingReader
		want     publicBranding
	}{
		{
			name: "configured",
			settings: authenticationStub{json.RawMessage(
				`{"workspace_name":" Example Team ","product_name":" Example Tool "}`,
			)},
			want: publicBranding{WorkspaceName: "Example Team", ProductName: "Example Tool"},
		},
		{
			name: "defaults without settings",
			want: publicBranding{WorkspaceName: defaultWorkspaceName, ProductName: defaultProductName},
		},
		{
			name:     "defaults for empty values",
			settings: authenticationStub{json.RawMessage(`{"workspace_name":" ","product_name":""}`)},
			want:     publicBranding{WorkspaceName: defaultWorkspaceName, ProductName: defaultProductName},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := NewService(nil, test.settings, "")
			request := httptest.NewRequest(http.MethodGet, "/branding", nil)
			response := httptest.NewRecorder()
			service.AuthRouter().ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("Cache-Control=%q", response.Header().Get("Cache-Control"))
			}
			var got publicBranding
			if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("branding=%+v want=%+v", got, test.want)
			}
		})
	}
}
