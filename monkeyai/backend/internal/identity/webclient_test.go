package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWebClientUsesInstanceCallback(t *testing.T) {
	const callback = "https://ai.example.com:18443/client/oauth/callback"
	s := NewService(nil, nil, "https://ai.example.com:18443/")
	other := NewService(nil, nil, "https://control.example.com")
	req := httptest.NewRequest(http.MethodGet, "https://control.example.com/clients", nil)
	req.Header.Set("X-Forwarded-Host", "control.example.com")
	response := httptest.NewRecorder()
	s.AuthRouter().ServeHTTP(response, req)
	var result struct{ Clients []Client }
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, client := range result.Clients {
		if client.ID == "monkeyai-web" {
			found = client.RedirectURI == callback
		}
	}
	if !found {
		t.Fatalf("客户端未登记本实例回调：%+v", result.Clients)
	}
	values, _ := callbackAuthorizationValues("monkeyai-web", callback)
	if _, err := s.newAuthorizationRequest(values); err != nil {
		t.Fatal(err)
	}
	if _, err := other.newAuthorizationRequest(values); err == nil {
		t.Fatal("其他实例接受了本实例的回调")
	}
	for _, invalid := range []string{
		"https://ai.example.com/client/oauth/callback", "http://ai.example.com:18443/client/oauth/callback",
		"/client/oauth/callback", "monkeyai-desktop://oauth/callback", "http://localhost:54321/oauth/callback",
		callback + "/", callback + "?", callback + "#fragment",
	} {
		values.Set("redirect_uri", invalid)
		if _, err := s.newAuthorizationRequest(values); err == nil {
			t.Errorf("接受了未登记回调 %q", invalid)
		}
	}
}
