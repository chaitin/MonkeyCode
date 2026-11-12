package codeup

import "testing"

func TestParseRepoPathSupportsStandardHTTPSCloneURL(t *testing.T) {
	orgID, identity, err := ParseRepoPath("https://codeup.aliyun.com/team/repo.git")
	if err != nil {
		t.Fatalf("ParseRepoPath() error = %v", err)
	}
	if orgID != "" {
		t.Fatalf("orgID = %q, want empty so caller can use stored organization ID", orgID)
	}
	if identity != "team/repo" {
		t.Fatalf("identity = %q, want %q", identity, "team/repo")
	}
}

func TestParseRepoPathPreservesNestedGroupPath(t *testing.T) {
	orgID, identity, err := ParseRepoPath("https://codeup.aliyun.com/team/platform/repo.git")
	if err != nil {
		t.Fatalf("ParseRepoPath() error = %v", err)
	}
	if orgID != "" {
		t.Fatalf("orgID = %q, want empty so caller can use stored organization ID", orgID)
	}
	if identity != "team/platform/repo" {
		t.Fatalf("identity = %q, want %q", identity, "team/platform/repo")
	}
}

func TestParseRepoPathSupportsStandardSSHCloneURL(t *testing.T) {
	orgID, identity, err := ParseRepoPath("git@codeup.aliyun.com:team/repo.git")
	if err != nil {
		t.Fatalf("ParseRepoPath() error = %v", err)
	}
	if orgID != "" {
		t.Fatalf("orgID = %q, want empty so caller can use stored organization ID", orgID)
	}
	if identity != "team/repo" {
		t.Fatalf("identity = %q, want %q", identity, "team/repo")
	}
}

func TestParseRepoPathKeepsSubdomainOrg(t *testing.T) {
	orgID, identity, err := ParseRepoPath("https://org-from-host.codeup.aliyun.com/team/repo.git")
	if err != nil {
		t.Fatalf("ParseRepoPath() error = %v", err)
	}
	if orgID != "org-from-host" {
		t.Fatalf("orgID = %q, want %q", orgID, "org-from-host")
	}
	if identity != "team/repo" {
		t.Fatalf("identity = %q, want %q", identity, "team/repo")
	}
}

func TestParseRepoPathRejectsIncompletePath(t *testing.T) {
	_, _, err := ParseRepoPath("https://codeup.aliyun.com/repo.git")
	if err == nil {
		t.Fatal("ParseRepoPath() error = nil, want invalid repository path error")
	}
}
