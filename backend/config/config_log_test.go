package config

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"reflect"
	"strings"
	"testing"
)

func TestConfigLogValueOmitsSecrets(t *testing.T) {
	const secret = "aiguard-token-must-not-be-logged"

	cfg := Config{
		Debug:          true,
		RootPath:       "/app",
		AdminToken:     secret,
		Context7ApiKey: secret,
	}
	cfg.Server.Addr = ":8888"
	cfg.Logger.Level = "debug"
	cfg.Redis.Pass = secret
	cfg.SMTP.Password = secret
	cfg.TaskFlow.CallbackToken = secret
	cfg.MCPHub.Token = secret
	cfg.ObjectStorage.AccessKeySecret = secret
	cfg.TaskSummary.ApiKey = secret
	cfg.ClickHouse.Password = secret
	cfg.LLM.APIKey = secret
	cfg.AIGuard.BaseURL = "https://aiguard.internal.example"
	cfg.AIGuard.APIToken = secret
	cfg.OAuthLogin.Google.ClientSecret = secret
	cfg.Wechat.MP.AppSecret = secret
	cfg.Wechat.MP.Token = secret
	cfg.Github.Token = secret

	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
	logger.With("config", &cfg).Debug("print config")

	if strings.Contains(buf.String(), secret) {
		t.Fatalf("debug log contains secret: %s", buf.String())
	}

	var entry struct {
		Config map[string]any `json:"config"`
	}
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("unmarshal log: %v", err)
	}
	want := map[string]any{
		"debug":        true,
		"server.addr":  ":8888",
		"root_path":    "/app",
		"logger.level": "debug",
	}
	if !reflect.DeepEqual(entry.Config, want) {
		t.Fatalf("logged config = %#v, want %#v", entry.Config, want)
	}
}
