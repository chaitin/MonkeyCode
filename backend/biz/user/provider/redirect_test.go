package provider

import "testing"

func TestCleanRedirectURLAllowsOnlySiteRelativePath(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		{name: "empty defaults", in: "", want: "/console/", ok: true},
		{name: "console path", in: "/console/tasks", want: "/console/tasks", ok: true},
		{name: "query kept", in: "/console/tasks?page=1", want: "/console/tasks?page=1", ok: true},
		{name: "absolute http denied", in: "https://evil.example.com", ok: false},
		{name: "scheme relative denied", in: "//evil.example.com", ok: false},
		{name: "backslash denied", in: `\\evil`, ok: false},
		{name: "relative without slash denied", in: "console/tasks", ok: false},
		{name: "control char denied", in: "/console/\n", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CleanRedirectURL(tt.in)
			if tt.ok && err != nil {
				t.Fatalf("CleanRedirectURL returned error: %v", err)
			}
			if !tt.ok && err == nil {
				t.Fatal("expected error")
			}
			if got != tt.want {
				t.Fatalf("got = %q, want %q", got, tt.want)
			}
		})
	}
}
