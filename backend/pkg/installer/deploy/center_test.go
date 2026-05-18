package deploy

import "testing"

func TestCenterAccessURLFormatsIPv6Host(t *testing.T) {
	got := CenterAccessURL("2001:db8::1", "8080")
	want := "http://[2001:db8::1]:8080"
	if got != want {
		t.Fatalf("CenterAccessURL() = %q, want %q", got, want)
	}
}
