package deploy

import (
	"regexp"
	"strings"
	"testing"
)

func TestCenterAccessURLFormatsIPv6Host(t *testing.T) {
	got := CenterAccessURL("2001:db8::1", "8080")
	want := "http://[2001:db8::1]:8080"
	if got != want {
		t.Fatalf("CenterAccessURL() = %q, want %q", got, want)
	}
}

func TestNewCenterEnvGeneratesRelaySecretUUID(t *testing.T) {
	env, err := NewCenterEnv(CenterEnvInput{})
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(env.RelaySecret) {
		t.Fatalf("RelaySecret = %q, want uuid v4", env.RelaySecret)
	}
}

func TestRenderCenterEnvWritesRelaySecret(t *testing.T) {
	rendered := RenderCenterEnv("RELAY_SECRET=\nTEAM_NAME=\n", CenterEnv{
		RelaySecret: "11111111-1111-4111-8111-111111111111",
		TeamName:    "MonkeyCode",
	})
	if !strings.Contains(rendered, "RELAY_SECRET=11111111-1111-4111-8111-111111111111") {
		t.Fatalf("rendered env missing relay secret: %q", rendered)
	}
}
