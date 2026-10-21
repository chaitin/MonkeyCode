package logging

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func BenchmarkHTTPStreaming(b *testing.B) {
	r, err := NewRuntime(io.Discard, slog.LevelInfo, DefaultSettings())
	if err != nil {
		b.Fatal(err)
	}
	defer r.Close()
	handler := HTTP(r.Logger())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for i := 0; i < 10; i++ {
			_, _ = io.WriteString(w, "data: hello\n\n")
			w.(http.Flusher).Flush()
		}
	}))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/v1/responses", nil))
	}
}
