package github

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	gh "github.com/google/go-github/v74/github"
)

func TestGetBlobWithClientDownloadsGitHubContentLargerThanOneMiB(t *testing.T) {
	payload := bytes.Repeat([]byte{0xab}, (1<<20)+1024)
	server := newBlobServer(t, payload)
	defer server.Close()

	client := gh.NewClient(server.Client())
	client.BaseURL = mustParseURL(t, server.URL+"/")

	got, err := getBlobWithClient(context.Background(), client, "owner", "repo", "main", "docs/demo.png", 10<<20)
	if err != nil {
		t.Fatalf("getBlobWithClient() error = %v", err)
	}
	if !bytes.Equal(got.Content, payload) {
		t.Fatalf("content length = %d, want %d", len(got.Content), len(payload))
	}
	if got.Sha != "large-sha" || got.Size != len(payload) {
		t.Fatalf("blob metadata = %#v", got)
	}
}

func TestGetBlobWithClientDoesNotBufferContentOverLimit(t *testing.T) {
	payload := bytes.Repeat([]byte{0xcd}, (2<<20)+1)
	server := newBlobServer(t, payload)
	defer server.Close()

	client := gh.NewClient(server.Client())
	client.BaseURL = mustParseURL(t, server.URL+"/")

	got, err := getBlobWithClient(context.Background(), client, "owner", "repo", "main", "docs/demo.png", 1<<20)
	if err != nil {
		t.Fatalf("getBlobWithClient() error = %v", err)
	}
	if len(got.Content) != 0 {
		t.Fatalf("content length = %d, want 0 for known oversized content", len(got.Content))
	}
	if got.Size != len(payload) {
		t.Fatalf("size = %d, want %d", got.Size, len(payload))
	}
}

func newBlobServer(t *testing.T, payload []byte) *httptest.Server {
	t.Helper()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/owner/repo/contents/docs/demo.png":
			writeJSON(t, w, map[string]any{
				"type": "file", "name": "demo.png", "path": "docs/demo.png",
				"sha": "large-sha", "size": len(payload), "encoding": "none",
				"download_url": server.URL + "/raw/demo.png",
			})
		case "/repos/owner/repo/contents/docs":
			writeJSON(t, w, []map[string]any{{
				"type": "file", "name": "demo.png", "path": "docs/demo.png",
				"sha": "large-sha", "size": len(payload), "encoding": "none",
				"download_url": server.URL + "/raw/demo.png",
			}})
		case "/raw/demo.png":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
	return server
}

func writeJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Fatalf("encode response: %v", err)
	}
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	return parsed
}
