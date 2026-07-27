package request

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestClientReturnsHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"code":"REQUEST_CONFLICT"}`))
	}))
	defer server.Close()

	endpoint, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := NewClient(endpoint.Scheme, endpoint.Host, time.Second)
	_, err = Get[any](client, context.Background(), "/")
	var httpErr *HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("error = %T, want *HTTPError", err)
	}
	if httpErr.StatusCode != http.StatusConflict || string(httpErr.Body) != `{"code":"REQUEST_CONFLICT"}` {
		t.Fatalf("unexpected HTTP error: %+v", httpErr)
	}
}

func TestWithHeaderMergesOptions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Route") != "route" || r.Header.Get("X-Fence") != "fence" {
			t.Fatalf("unexpected headers: %v", r.Header)
		}
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	endpoint, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := NewClient(endpoint.Scheme, endpoint.Host, time.Second)
	_, err = Get[any](client, context.Background(), "/",
		WithHeader(Header{"X-Route": "route"}),
		WithHeader(Header{"X-Fence": "fence"}),
	)
	if err != nil {
		t.Fatal(err)
	}
}
