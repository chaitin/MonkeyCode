package steps

import (
	"testing"
)

func TestServiceFormPopulatesInput(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	r.FormAns = [][]string{{
		"/data/myapp",
		"192.168.1.10",
		"8080",
		"admin@example.com",
		"MyTeam",
		"secret123",
	}}

	if err := (&ServiceForm{}).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if ctx.Input.InstallDir != "/data/myapp" {
		t.Fatalf("InstallDir = %q", ctx.Input.InstallDir)
	}
	if ctx.Input.AccessHost != "192.168.1.10" {
		t.Fatalf("AccessHost = %q", ctx.Input.AccessHost)
	}
	if ctx.Input.NginxPort != "8080" {
		t.Fatalf("NginxPort = %q", ctx.Input.NginxPort)
	}
	if ctx.Input.TeamEmail != "admin@example.com" {
		t.Fatalf("TeamEmail = %q", ctx.Input.TeamEmail)
	}
	if ctx.Input.TeamName != "MyTeam" {
		t.Fatalf("TeamName = %q", ctx.Input.TeamName)
	}
	if ctx.Input.TeamPassword != "secret123" {
		t.Fatalf("TeamPassword = %q", ctx.Input.TeamPassword)
	}
}

func TestServiceFormEmptyPasswordOK(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	r.FormAns = [][]string{{
		"/data/myapp",
		"192.168.1.10",
		"80",
		"admin@example.com",
		"MyTeam",
		"",
	}}
	if err := (&ServiceForm{}).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if ctx.Input.TeamPassword != "" {
		t.Fatal("TeamPassword should remain empty when not provided")
	}
}

func TestServiceFormRejectsInvalidPort(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	r.FormAns = [][]string{{
		"/data/myapp",
		"192.168.1.10",
		"70000",
		"admin@example.com",
		"MyTeam",
		"",
	}}

	err := (&ServiceForm{}).Run(ctx)
	if err == nil {
		t.Fatal("expected invalid port error")
	}
}

func TestServiceFormRejectsInvalidEmail(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	r.FormAns = [][]string{{
		"/data/myapp",
		"192.168.1.10",
		"8080",
		"admin@",
		"MyTeam",
		"",
	}}

	err := (&ServiceForm{}).Run(ctx)
	if err == nil {
		t.Fatal("expected invalid email error")
	}
}

func TestServiceFormRejectsURLAccessHost(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	r.FormAns = [][]string{{
		"/data/myapp",
		"http://example.com",
		"8080",
		"admin@example.com",
		"MyTeam",
		"",
	}}

	err := (&ServiceForm{}).Run(ctx)
	if err == nil {
		t.Fatal("expected invalid access host error")
	}
}
