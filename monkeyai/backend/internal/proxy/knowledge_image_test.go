package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestKnowledgeImageBodyLimitIsPrivate(t *testing.T) {
	p := NewProxy(nil, nil)
	// Encoded length of a 32 MiB original, plus the surrounding model JSON.
	body := `{"model":"vision","image":"` + strings.Repeat("A", 44739244) + `"}`
	for _, tc := range []struct {
		name  string
		serve http.HandlerFunc
		want  int
	}{
		{"private", p.ServeKnowledgeImage, http.StatusServiceUnavailable}, // reached the unconfigured resolver
		{"public", p.ServeHTTP, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
			r.Header.Set("User-Agent", "ohmyagent-kb-image")
			r.Header.Set("Authorization", "Bearer internal-kb-image")
			w := httptest.NewRecorder()
			tc.serve(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d, want %d", w.Code, tc.want)
			}
		})
	}
}
