package taskflow

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestRestartTaskReqMarshalExecutionConfig(t *testing.T) {
	mode := uint32(0o600)
	req := RestartTaskReq{
		ID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		RequestId:   "req-switch",
		LoadSession: true,
		ExecutionConfig: &TaskExecutionConfig{
			Envs: map[string]string{
				"OPENAI_API_KEY": "sk-test",
			},
			ConfigFiles: []ConfigFile{
				{
					Path:    "~/.config/opencode/opencode.json",
					Content: "{}",
					Mode:    &mode,
				},
			},
			McpServers: []McpServerConfig{
				{Name: "mcaiBuiltin", Type: "http"},
			},
		},
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	cfg, ok := got["execution_config"].(map[string]any)
	if !ok {
		t.Fatalf("execution_config = %v, want object", got["execution_config"])
	}
	envs, ok := cfg["envs"].(map[string]any)
	if !ok {
		t.Fatalf("envs = %v, want object", cfg["envs"])
	}
	if envs["OPENAI_API_KEY"] != "sk-test" {
		t.Fatalf("OPENAI_API_KEY = %v, want sk-test", envs["OPENAI_API_KEY"])
	}
	files, ok := cfg["config_files"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("config_files = %v, want one item", cfg["config_files"])
	}
	file, ok := files[0].(map[string]any)
	if !ok {
		t.Fatalf("config file = %v, want object", files[0])
	}
	if file["mode"] != float64(mode) {
		t.Fatalf("config file mode = %v, want %d", file["mode"], mode)
	}
}

func TestCreateVirtualMachineReqIncludesLogStore(t *testing.T) {
	req := CreateVirtualMachineReq{
		UserID:   "u-1",
		HostID:   "h-1",
		TaskID:   uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		LogStore: "clickhouse",
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"log_store":"clickhouse"`) {
		t.Fatalf("marshaled request missing log_store: %s", string(b))
	}
}

func TestRestartTaskReqIncludesLogStore(t *testing.T) {
	req := RestartTaskReq{
		ID:        uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		RequestId: "req-1",
		LogStore:  "clickhouse",
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"log_store":"clickhouse"`) {
		t.Fatalf("marshaled request missing log_store: %s", string(b))
	}
}

func TestAskUserQuestionResponseIncludesLogStore(t *testing.T) {
	req := AskUserQuestionResponse{
		TaskId:      "task-1",
		RequestId:   "req-1",
		AnswersJson: `{"ok":true}`,
		LogStore:    "clickhouse",
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"log_store":"clickhouse"`) {
		t.Fatalf("marshaled request missing log_store: %s", string(b))
	}
}

func TestTaskReqIncludesLogStore(t *testing.T) {
	req := TaskReq{
		Task: &Task{
			ID:       uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			LogStore: "clickhouse",
		},
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"log_store":"clickhouse"`) {
		t.Fatalf("marshaled request missing log_store: %s", string(b))
	}
}

func TestTaskAttachmentURLsSerialize(t *testing.T) {
	req := TaskReq{
		Task: &Task{
			AttachmentURLs: []string{"https://oss.example.com/temp/a.txt"},
		},
	}
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if !strings.Contains(string(b), `"attachment_urls":["https://oss.example.com/temp/a.txt"]`) {
		t.Fatalf("json = %s", b)
	}
}
