package oauth

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRefreshGiteeUsesConfiguredHTTPBaseURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/oauth/token" {
			t.Errorf("path = %s, want /oauth/token", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Errorf("ParseForm() error = %v", err)
		}
		if got := r.Form.Get("refresh_token"); got != "refresh-token" {
			t.Errorf("refresh_token = %q, want refresh-token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"access_token":"access-token","refresh_token":"next-token","expires_in":3600}`)
	}))
	defer server.Close()

	resp, err := RefreshGitee(server.URL+"/", "refresh-token")
	if err != nil {
		t.Fatalf("RefreshGitee() error = %v", err)
	}
	if resp.AccessToken != "access-token" || resp.RefreshToken != "next-token" {
		t.Fatalf("RefreshGitee() = %+v", resp)
	}
}
