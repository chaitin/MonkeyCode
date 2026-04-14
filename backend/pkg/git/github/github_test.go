package github

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	gh "github.com/google/go-github/v74/github"
	"github.com/palantir/go-githubapp/githubapp"
	githubv4 "github.com/shurcooL/githubv4"
	"golang.org/x/oauth2"
)

func TestGetInstallation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/api/v3/app/installations/42" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":42,"account":{"login":"octocat"}}`))
	}))
	defer server.Close()

	appClient := gh.NewClient(server.Client())
	appClient, err := appClient.WithEnterpriseURLs(server.URL+"/", server.URL+"/")
	if err != nil {
		t.Fatalf("configure enterprise client: %v", err)
	}

	client := &Github{
		githubapp: &stubGithubClientCreator{appClient: appClient},
	}

	installation, err := client.GetInstallation(context.Background(), 42)
	if err != nil {
		t.Fatalf("GetInstallation returned error: %v", err)
	}
	if installation.GetID() != 42 {
		t.Fatalf("expected installation id 42, got %d", installation.GetID())
	}
	if installation.GetAccount().GetLogin() != "octocat" {
		t.Fatalf("expected login octocat, got %q", installation.GetAccount().GetLogin())
	}
}

func TestGetPullRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/repos/octo/repo/pulls/10" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":2001,"number":10,"title":"Fix bug","html_url":"https://github.com/octo/repo/pull/10"}`))
	}))
	defer server.Close()

	client := &Github{}
	pr, err := client.GetPullRequest(context.Background(), "installation-token", server.URL+"/repos/octo/repo/pulls/10")
	if err != nil {
		t.Fatalf("GetPullRequest returned error: %v", err)
	}
	if pr.GetID() != 2001 {
		t.Fatalf("expected PR id 2001, got %d", pr.GetID())
	}
	if pr.GetNumber() != 10 {
		t.Fatalf("expected PR number 10, got %d", pr.GetNumber())
	}
	if pr.GetTitle() != "Fix bug" {
		t.Fatalf("expected PR title Fix bug, got %q", pr.GetTitle())
	}
}

func TestGetPullRequest_ReturnsErrorOnNon200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusBadGateway)
	}))
	defer server.Close()

	client := &Github{}
	_, err := client.GetPullRequest(context.Background(), "installation-token", server.URL+"/repos/octo/repo/pulls/10")
	if err == nil {
		t.Fatal("expected GetPullRequest to return error")
	}
	if err.Error() != "get pull request status 502" {
		t.Fatalf("unexpected error: %v", err)
	}
}

type stubGithubClientCreator struct {
	appClient          *gh.Client
	installationClient *gh.Client
	appErr             error
	installationErr    error
}

func (s *stubGithubClientCreator) NewAppClient() (*gh.Client, error) {
	if s.appErr != nil {
		return nil, s.appErr
	}
	return s.appClient, nil
}

func (*stubGithubClientCreator) NewAppV4Client() (*githubv4.Client, error) {
	return nil, nil
}

func (s *stubGithubClientCreator) NewInstallationClient(int64) (*gh.Client, error) {
	if s.installationErr != nil {
		return nil, s.installationErr
	}
	return s.installationClient, nil
}

func (*stubGithubClientCreator) NewInstallationV4Client(int64) (*githubv4.Client, error) {
	return nil, nil
}

func (*stubGithubClientCreator) NewTokenSourceClient(oauth2.TokenSource) (*gh.Client, error) {
	return nil, nil
}

func (*stubGithubClientCreator) NewTokenSourceV4Client(oauth2.TokenSource) (*githubv4.Client, error) {
	return nil, nil
}

func (*stubGithubClientCreator) NewTokenClient(string) (*gh.Client, error) {
	return nil, nil
}

func (*stubGithubClientCreator) NewTokenV4Client(string) (*githubv4.Client, error) {
	return nil, nil
}

var _ githubapp.ClientCreator = (*stubGithubClientCreator)(nil)
