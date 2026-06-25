package asseturl

import "testing"

func TestBuildReturnsRelativeAssetPath(t *testing.T) {
	got := Build("temp/user_id/a #?.png")
	want := "/api/v1/assets?key=temp%2Fuser_id%2Fa+%23%3F.png"
	if got != want {
		t.Fatalf("Build() = %q, want %q", got, want)
	}
}

func TestParseAcceptsRelativeAssetPath(t *testing.T) {
	got, ok := Parse("/api/v1/assets?key=temp%2Fuser_id%2Fa.png")
	if !ok {
		t.Fatal("Parse() ok = false")
	}
	if got != "temp/user_id/a.png" {
		t.Fatalf("key = %q", got)
	}
}

func TestParseRejectsUnsafeKey(t *testing.T) {
	if _, ok := Parse("/api/v1/assets?key=../secret"); ok {
		t.Fatal("Parse() ok = true, want false")
	}
}
