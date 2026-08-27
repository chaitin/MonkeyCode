package v1

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestInternalAuth(t *testing.T) {
	const token = "test-internal-token"

	tests := []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{name: "missing token", wantStatus: http.StatusUnauthorized},
		{name: "invalid scheme", authorization: "Basic " + token, wantStatus: http.StatusUnauthorized},
		{name: "invalid token", authorization: "Bearer invalid", wantStatus: http.StatusUnauthorized},
		{name: "valid token", authorization: "Bearer " + token, wantStatus: http.StatusNoContent},
		{name: "case insensitive scheme", authorization: "bearer " + token, wantStatus: http.StatusNoContent},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			h := &InternalHostHandler{internalToken: token}
			g := e.Group("/internal")
			g.Use(h.internalAuth())
			g.GET("/test", func(c echo.Context) error {
				return c.NoContent(http.StatusNoContent)
			})

			req := httptest.NewRequest(http.MethodGet, "/internal/test", nil)
			if tt.authorization != "" {
				req.Header.Set(echo.HeaderAuthorization, tt.authorization)
			}
			resp := httptest.NewRecorder()
			e.ServeHTTP(resp, req)

			if resp.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", resp.Code, tt.wantStatus)
			}
			if tt.wantStatus == http.StatusUnauthorized && resp.Header().Get("WWW-Authenticate") != "Bearer" {
				t.Fatalf("WWW-Authenticate = %q, want Bearer", resp.Header().Get("WWW-Authenticate"))
			}
		})
	}
}
