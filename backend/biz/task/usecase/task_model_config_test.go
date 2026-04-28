package usecase

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestOpencodeNpmPackage(t *testing.T) {
	tests := []struct {
		name          string
		interfaceType string
		want          string
	}{
		{
			name:          "openai chat",
			interfaceType: string(consts.InterfaceTypeOpenAIChat),
			want:          "@ai-sdk/openai-compatible",
		},
		{
			name:          "openai responses",
			interfaceType: string(consts.InterfaceTypeOpenAIResponse),
			want:          "@ai-sdk/openai",
		},
		{
			name:          "anthropic",
			interfaceType: string(consts.InterfaceTypeAnthropic),
			want:          "@ai-sdk/anthropic",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := opencodeNpmPackage(tt.interfaceType)
			if err != nil {
				t.Fatalf("opencodeNpmPackage() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("opencodeNpmPackage() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestOpencodeNpmPackageUnsupported(t *testing.T) {
	_, err := opencodeNpmPackage("custom")
	if err == nil {
		t.Fatal("opencodeNpmPackage() error is nil")
	}
	if !strings.Contains(err.Error(), "unsupported interface type: custom") {
		t.Fatalf("opencodeNpmPackage() error = %q", err.Error())
	}
	if !strings.Contains(err.Error(), "openai_chat, openai_responses, anthropic") {
		t.Fatalf("opencodeNpmPackage() error = %q, want supported types", err.Error())
	}
}

func TestModelRuntimeDefaults(t *testing.T) {
	thinking, contextLimit, outputLimit := modelRuntimeDefaults(&db.Model{
		ThinkingEnabled: true,
	})
	if !thinking {
		t.Fatal("modelRuntimeDefaults() thinking = false, want true")
	}
	if contextLimit != 200000 {
		t.Fatalf("modelRuntimeDefaults() contextLimit = %d, want 200000", contextLimit)
	}
	if outputLimit != 32000 {
		t.Fatalf("modelRuntimeDefaults() outputLimit = %d, want 32000", outputLimit)
	}

	thinking, contextLimit, outputLimit = modelRuntimeDefaults(&db.Model{
		ThinkingEnabled: false,
		ContextLimit:    128000,
		OutputLimit:     16000,
	})
	if thinking {
		t.Fatal("modelRuntimeDefaults() thinking = true, want false")
	}
	if contextLimit != 128000 {
		t.Fatalf("modelRuntimeDefaults() contextLimit = %d, want 128000", contextLimit)
	}
	if outputLimit != 16000 {
		t.Fatalf("modelRuntimeDefaults() outputLimit = %d, want 16000", outputLimit)
	}
}

func TestGetCodingConfigsOpenCodeRendersRuntimeConfigEnabled(t *testing.T) {
	uc := &TaskUsecase{}
	model := &db.Model{
		BaseURL:         "https://example.com/v1",
		Model:           "gpt-4.1",
		APIKey:          "sk-test",
		InterfaceType:   string(consts.InterfaceTypeOpenAIResponse),
		ThinkingEnabled: true,
		ContextLimit:    128000,
		OutputLimit:     16000,
	}

	coding, cfs, err := uc.getCodingConfigs(consts.CliNameOpencode, model, nil)
	if err != nil {
		t.Fatalf("getCodingConfigs() error = %v", err)
	}
	if coding != taskflow.CodingAgentOpenCode {
		t.Fatalf("getCodingConfigs() coding = %v, want %v", coding, taskflow.CodingAgentOpenCode)
	}

	config := opencodeConfig(t, cfs)
	provider := opencodeProvider(t, config)
	if got := provider["npm"]; got != "@ai-sdk/openai" {
		t.Fatalf("provider npm = %v, want @ai-sdk/openai", got)
	}
	auth := opencodeAuthConfig(t, cfs)
	if auth.Mode == nil || *auth.Mode != 0o600 {
		t.Fatalf("auth mode = %v, want 0600", auth.Mode)
	}

	renderedModel := opencodeModel(t, provider, "gpt-4.1")
	assertLimit(t, renderedModel, 128000, 16000)
	if options, ok := renderedModel["options"].(map[string]any); ok {
		if thinking, ok := options["thinking"]; ok {
			t.Fatalf("model thinking options = %v, want absent", thinking)
		}
	}
}

func TestGetCodingConfigsOpenCodeRendersThinkingDisabled(t *testing.T) {
	uc := &TaskUsecase{}
	model := &db.Model{
		BaseURL:         "https://example.com/v1",
		Model:           "claude-sonnet-4",
		APIKey:          "sk-test",
		InterfaceType:   string(consts.InterfaceTypeAnthropic),
		ThinkingEnabled: false,
	}

	_, cfs, err := uc.getCodingConfigs(consts.CliNameOpencode, model, nil)
	if err != nil {
		t.Fatalf("getCodingConfigs() error = %v", err)
	}

	config := opencodeConfig(t, cfs)
	provider := opencodeProvider(t, config)
	if got := provider["npm"]; got != "@ai-sdk/anthropic" {
		t.Fatalf("provider npm = %v, want @ai-sdk/anthropic", got)
	}

	renderedModel := opencodeModel(t, provider, "claude-sonnet-4")
	assertLimit(t, renderedModel, 200000, 32000)
	options, ok := renderedModel["options"].(map[string]any)
	if !ok {
		t.Fatal("model options is absent")
	}
	thinking, ok := options["thinking"].(map[string]any)
	if !ok {
		t.Fatalf("model thinking options = %v, want object", options["thinking"])
	}
	if got := thinking["type"]; got != "disabled" {
		t.Fatalf("thinking type = %v, want disabled", got)
	}
}

func TestGetCodingConfigsNilModel(t *testing.T) {
	uc := &TaskUsecase{}
	_, _, err := uc.getCodingConfigs(consts.CliNameOpencode, nil, nil)
	if err == nil {
		t.Fatal("getCodingConfigs() error is nil")
	}
	if !strings.Contains(err.Error(), "model is nil") {
		t.Fatalf("getCodingConfigs() error = %q", err.Error())
	}
}

func opencodeAuthConfig(t *testing.T, cfs []taskflow.ConfigFile) taskflow.ConfigFile {
	t.Helper()
	for _, cf := range cfs {
		if cf.Path == "~/.local/share/opencode/auth.json" {
			return cf
		}
	}
	t.Fatal("opencode auth file not found")
	return taskflow.ConfigFile{}
}

func opencodeConfig(t *testing.T, cfs []taskflow.ConfigFile) map[string]any {
	t.Helper()
	for _, cf := range cfs {
		if cf.Path != "~/.config/opencode/opencode.json" {
			continue
		}
		var config map[string]any
		if err := json.Unmarshal([]byte(cf.Content), &config); err != nil {
			t.Fatalf("opencode config JSON invalid: %v\n%s", err, cf.Content)
		}
		return config
	}
	t.Fatal("opencode config file not found")
	return nil
}

func opencodeProvider(t *testing.T, config map[string]any) map[string]any {
	t.Helper()
	providers, ok := config["provider"].(map[string]any)
	if !ok {
		t.Fatalf("provider = %v, want object", config["provider"])
	}
	provider, ok := providers["monkeycode-ai"].(map[string]any)
	if !ok {
		t.Fatalf("provider monkeycode-ai = %v, want object", providers["monkeycode-ai"])
	}
	return provider
}

func opencodeModel(t *testing.T, provider map[string]any, modelName string) map[string]any {
	t.Helper()
	models, ok := provider["models"].(map[string]any)
	if !ok {
		t.Fatalf("models = %v, want object", provider["models"])
	}
	model, ok := models[modelName].(map[string]any)
	if !ok {
		t.Fatalf("model %q = %v, want object", modelName, models[modelName])
	}
	return model
}

func assertLimit(t *testing.T, model map[string]any, wantContext, wantOutput int) {
	t.Helper()
	limit, ok := model["limit"].(map[string]any)
	if !ok {
		t.Fatalf("limit = %v, want object", model["limit"])
	}
	context, ok := limit["context"].(float64)
	if !ok {
		t.Fatalf("limit context = %v, want number", limit["context"])
	}
	if got := int(context); got != wantContext {
		t.Fatalf("limit context = %d, want %d", got, wantContext)
	}
	output, ok := limit["output"].(float64)
	if !ok {
		t.Fatalf("limit output = %v, want number", limit["output"])
	}
	if got := int(output); got != wantOutput {
		t.Fatalf("limit output = %d, want %d", got, wantOutput)
	}
}
