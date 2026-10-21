package config

import (
	"bytes"
	"errors"
	"flag"
	"log/slog"
	"strings"
	"testing"
)

func TestParseLogLevelWithoutBusinessConfiguration(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "")
	t.Setenv("MONKEYAI_SHUTDOWN_TIMEOUT", "invalid")
	t.Setenv("MONKEYAI_LOG_LEVEL", "warn")
	for _, test := range []struct {
		args []string
		want slog.Level
	}{
		{nil, slog.LevelWarn},
		{[]string{"--log-level", "debug", "--http-addr", ":9090"}, slog.LevelDebug},
		{[]string{"--database-url", "--log-level=debug"}, slog.LevelWarn},
		{[]string{"--log-level=error"}, slog.LevelError},
	} {
		level, err := ParseLogLevel(test.args)
		if err != nil || level != test.want {
			t.Fatalf("%v: %v %v", test.args, level, err)
		}
	}
	if _, err := ParseLogLevel([]string{"--help"}); !errors.Is(err, flag.ErrHelp) {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"--log-level=private-secret"}, {"--unknown=private-secret"}, {"private-secret"}, {"--shutdown-timeout=private-secret"}} {
		_, err := ParseLogLevel(args)
		if err == nil || strings.Contains(err.Error(), "private-secret") {
			t.Fatalf("unsafe error: %v", err)
		}
	}
}

func TestHelpDoesNotIncludeEnvironmentSecrets(t *testing.T) {
	t.Setenv("MONKEYAI_DATABASE_URL", "postgres://private-secret")
	var output bytes.Buffer
	PrintUsage(&output)
	if strings.Contains(output.String(), "private-secret") || !strings.Contains(output.String(), "-log-level") {
		t.Fatal(output.String())
	}
}
