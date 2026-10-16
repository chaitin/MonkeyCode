package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBrowserDeviceConsent(t *testing.T) {
	output := os.Getenv("MONKEYAI_BROWSER_DEVICE_DIR")
	if output == "" {
		t.Skip("设置 MONKEYAI_BROWSER_DEVICE_DIR 配合真实浏览器验收设备确认")
	}
	s, _, cookie, _ := deviceService(t)
	s.publicURL = ""
	s.secureCookie = false
	dist, err := filepath.Abs("../../../admin/dist")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/device" {
			http.SetCookie(w, cookie)
			http.ServeFile(w, r, filepath.Join(dist, "index.html"))
			return
		}
		if len(r.URL.Path) >= 13 && r.URL.Path[:13] == "/api/auth/v1/" {
			http.StripPrefix("/api/auth/v1", s.AuthRouter()).ServeHTTP(w, r)
			return
		}
		http.FileServer(http.Dir(dist)).ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	s.publicURL = server.URL
	response := deviceApplication(t, s)
	data, _ := json.Marshal(map[string]string{"url": response.VerificationURIComplete})
	if err = os.WriteFile(filepath.Join(output, "ready.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-t.Context().Done():
			t.Fatal("设备确认浏览器验收超时")
		case <-ticker.C:
			if _, err := os.Stat(filepath.Join(output, "approved")); os.IsNotExist(err) {
				continue
			}
			token, err := s.ExchangeDeviceCode(context.Background(), RuntimeClientID, response.DeviceCode)
			if err != nil || token.GrantID == "" {
				t.Fatalf("浏览器批准后无法兑换：%v", err)
			}
			return
		}
	}
}
