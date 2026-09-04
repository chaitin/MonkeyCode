package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPprofRegistered(t *testing.T) {
	recorder := httptest.NewRecorder()
	http.DefaultServeMux.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil),
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
}
