package gitee

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestGiteeUsesConfiguredHTTPBaseURL(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v5/user/repos":
			if got := r.URL.Query().Get("access_token"); got != "test-token" {
				t.Errorf("access_token = %q, want test-token", got)
			}
			fmt.Fprint(w, `[{"full_name":"owner/repo","html_url":"http://example.com/owner/repo"}]`)
		case "/api/v5/user":
			if got := r.Header.Get("Authorization"); got != "token test-token" {
				t.Errorf("Authorization = %q, want token test-token", got)
			}
			fmt.Fprint(w, `{"login":"alice"}`)
		case "/api/v5/repos/owner/repo/branches":
			if got := r.Header.Get("Authorization"); got != "token test-token" {
				t.Errorf("Authorization = %q, want token test-token", got)
			}
			fmt.Fprint(w, `[{"name":"main"}]`)
		default:
			t.Errorf("unexpected request path: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	client := NewGitee(server.URL+"/", logger)
	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if got := client.BaseURL(); got != server.URL {
		t.Fatalf("BaseURL() = %q, want %q", got, server.URL)
	}
	if got := client.client.GetScheme(); got != "http" {
		t.Fatalf("client scheme = %q, want http", got)
	}
	if got := client.client.GetHost(); got != parsed.Host {
		t.Fatalf("client host = %q, want %q", got, parsed.Host)
	}

	repos, err := client.Repositories(context.Background(), &domain.RepositoryOptions{Token: "test-token"})
	if err != nil {
		t.Fatalf("Repositories() error = %v", err)
	}
	if len(repos.Repositories) != 1 || repos.Repositories[0].FullName != "owner/repo" {
		t.Fatalf("Repositories() = %+v", repos.Repositories)
	}

	user, err := client.UserInfo(context.Background(), "test-token")
	if err != nil {
		t.Fatalf("UserInfo() error = %v", err)
	}
	if user.Name != "alice" {
		t.Fatalf("UserInfo().Name = %q, want alice", user.Name)
	}

	branches, err := client.Branches(context.Background(), &domain.BranchesOptions{
		Token: "test-token", Owner: "owner", Repo: "repo", Page: 1, PerPage: 20,
	})
	if err != nil {
		t.Fatalf("Branches() error = %v", err)
	}
	if len(branches) != 1 || branches[0].Name != "main" {
		t.Fatalf("Branches() = %+v", branches)
	}

	if got := requests.Load(); got != 3 {
		t.Fatalf("request count = %d, want 3", got)
	}
}

func TestParseGiteeRepoPathWithPrivateInstance(t *testing.T) {
	owner, repo, err := ParseRepoPath("http://gitee.internal/owner/repo.git")
	if err != nil {
		t.Fatal(err)
	}
	if owner != "owner" || repo != "repo" {
		t.Fatalf("ParseRepoPath() = %q, %q; want owner, repo", owner, repo)
	}
}
