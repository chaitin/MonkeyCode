package config

import "testing"

func TestGetGithubAppInstallRedirectURL_DefaultSlash(t *testing.T) {
	cfg := &Config{}
	if got := cfg.GetGithubAppInstallRedirectURL(); got != "/" {
		t.Fatalf("expected /, got %q", got)
	}
}

func TestTaskConfigCarriesGithubCommentDefaults(t *testing.T) {
	cfg, err := Init(t.TempDir())
	if err != nil {
		t.Fatalf("init config: %v", err)
	}
	if cfg.Task.AtKeyword != "" {
		t.Fatalf("expected empty default at keyword, got %q", cfg.Task.AtKeyword)
	}
	if len(cfg.Task.HostIDs) != 0 {
		t.Fatalf("expected empty host ids by default, got %v", cfg.Task.HostIDs)
	}
}
