package app

import (
	"bytes"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

func TestVisionDescriptionPreservesLiteralOCR(t *testing.T) {
	samples := []string{
		"<script>alert(1)</script>\n<img src=\"https://example.com/a.png\">",
		"![示例](https://example.com/a.png)\n[链接](javascript:alert(1))",
		"```\n</code><script>alert(1)</script>\n``````\n![狗](https://example.com/dog.png)",
		"第一行\n  缩进内容\n\n| 名称 | 数量 |\n| 狗 | 2 |",
	}
	for _, sample := range samples {
		t.Run(sample, func(t *testing.T) {
			result, _ := json.Marshal(resource.Object{"description": sample, "text": sample})
			body, _ := json.Marshal(resource.Object{"choices": []any{resource.Object{"finish_reason": "stop", "message": resource.Object{"content": string(result)}}}})
			content, err := visionDescription(model.ProtocolOpenAIChat, body)
			if err != nil {
				t.Fatal(err)
			}
			source := []byte(content)
			root := goldmark.DefaultParser().Parse(text.NewReader(source))
			blocks := 0
			_ = ast.Walk(root, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
				if !entering {
					return ast.WalkContinue, nil
				}
				switch n := n.(type) {
				case *ast.Image, *ast.Link, *ast.RawHTML, *ast.HTMLBlock:
					t.Errorf("OCR interpreted as active Markdown: %T", n)
				case *ast.FencedCodeBlock:
					blocks++
					if got := string(n.Lines().Value(source)); got != sample+"\n" {
						t.Errorf("literal text changed: %q", got)
					}
				}
				return ast.WalkContinue, nil
			})
			if blocks != 2 {
				t.Fatalf("expected two literal sections, got %d", blocks)
			}
		})
	}
}

func TestVisionProtocolsCarryImageAndRejectIncompleteResults(t *testing.T) {
	result := `{"description":"一只棕色的狗坐在草地上。","text":""}`
	for _, protocol := range []model.Protocol{model.ProtocolOpenAIChat, model.ProtocolOpenAIResponses, model.ProtocolAnthropic} {
		t.Run(string(protocol), func(t *testing.T) {
			m := model.Model{ID: "model", Protocol: protocol, AdvancedConfig: model.AdvancedConfig{MaxOutputTokens: 4096}}
			path, body, err := visionRequest(m, "image/png", []byte("image-bytes"))
			if err != nil || path == "" || !strings.Contains(string(body), "aW1hZ2UtYnl0ZXM=") {
				t.Fatalf("request path=%s err=%v", path, err)
			}
			var payload map[string]any
			if json.Unmarshal(body, &payload) != nil || payload["model"] != "model" {
				t.Fatal("invalid payload")
			}
			var response any
			switch protocol {
			case model.ProtocolOpenAIChat:
				response = map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"content": result}}}}
			case model.ProtocolOpenAIResponses:
				response = map[string]any{"status": "completed", "output": []any{map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": result}}}}}
			case model.ProtocolAnthropic:
				response = map[string]any{"stop_reason": "end_turn", "content": []any{map[string]any{"type": "text", "text": result}}}
			}
			raw, _ := json.Marshal(response)
			description, err := visionDescription(protocol, raw)
			if err != nil || !strings.Contains(description, "狗") || !strings.Contains(description, "未见可辨识文字") {
				t.Fatalf("%s %v", description, err)
			}
		})
	}
	for _, sample := range []struct {
		protocol model.Protocol
		body     string
	}{
		{model.ProtocolOpenAIChat, `{"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}`},
		{model.ProtocolOpenAIChat, `{"choices":[{"finish_reason":"stop","message":{"refusal":"refused","content":""}}]}`},
		{model.ProtocolOpenAIResponses, `{"status":"incomplete"}`},
		{model.ProtocolAnthropic, `{"stop_reason":"max_tokens"}`},
		{model.ProtocolAnthropic, `{"stop_reason":"end_turn","content":[{"type":"text","text":"{\"description\":\"\",\"text\":\"\"}"}]}`},
	} {
		if _, err := visionDescription(sample.protocol, []byte(sample.body)); err == nil {
			t.Fatalf("accepted %s", sample.body)
		}
	}
}

func TestKnowledgeVisionGatewayIntegration(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	pool := designAppDatabase(t)
	ctx := t.Context()
	actor, other := resource.ID(), resource.ID()
	for _, id := range []string{actor, other} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'vision',$2,'admin')`, id, id+"@vision.test"); err != nil {
			t.Fatal(err)
		}
	}
	repo := model.NewPostgres(pool)
	models := model.NewService(repo)
	settings := setting.NewService(setting.NewPostgres(pool))
	services := executionServices{pool: pool, modelRepo: repo, models: models, settings: settings}
	v := knowledgeVision{services: services, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	for _, protocol := range []model.Protocol{model.ProtocolOpenAIChat, model.ProtocolOpenAIResponses, model.ProtocolAnthropic} {
		t.Run(string(protocol), func(t *testing.T) {
			var calls atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				if !bytes.Contains(data, []byte("aW1hZ2UtYnl0ZXM=")) || !bytes.Contains(data, []byte(`"upstream-vision"`)) {
					t.Error("image or upstream model missing")
				}
				if protocol == model.ProtocolAnthropic {
					if r.Header.Get("X-Api-Key") != "provider-secret" {
						t.Error("missing Anthropic auth")
					}
				} else if r.Header.Get("Authorization") != "Bearer provider-secret" {
					t.Error("missing provider auth")
				}
				text := `{"description":"一只狗坐在草地上。","text":""}`
				var response any
				switch protocol {
				case model.ProtocolOpenAIChat:
					response = resource.Object{"choices": []any{resource.Object{"finish_reason": "stop", "message": resource.Object{"content": text}}}, "usage": resource.Object{"prompt_tokens": 10, "completion_tokens": 20}}
				case model.ProtocolOpenAIResponses:
					response = resource.Object{"status": "completed", "output": []any{resource.Object{"type": "message", "content": []any{resource.Object{"type": "output_text", "text": text}}}}, "usage": resource.Object{"input_tokens": 10, "output_tokens": 20}}
				case model.ProtocolAnthropic:
					response = resource.Object{"stop_reason": "end_turn", "content": []any{resource.Object{"type": "text", "text": text}}, "usage": resource.Object{"input_tokens": 10, "output_tokens": 20}}
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(response)
			}))
			defer upstream.Close()
			id := resource.ID()
			_, err := pool.Exec(ctx, `INSERT INTO models(id,ownership_type,owner_user_id,model_id,display_name,protocol,base_url,api_key,advanced_config) VALUES($1,'user',$2,'upstream-vision','Vision',$3,$4,'provider-secret','{"context_window_tokens":128000,"max_output_tokens":4096,"supports_vision":true}')`, id, actor, string(protocol), upstream.URL+"/v1")
			if err != nil {
				t.Fatal(err)
			}
			output, err := v.DescribeImage(ctx, actor, id, "image/png", []byte("image-bytes"))
			if err != nil || !strings.Contains(output, "狗") {
				t.Fatalf("%s %v", output, err)
			}
			if calls.Load() != 1 {
				t.Fatal("unexpected upstream calls")
			}
			var recorded int
			if err = pool.QueryRow(ctx, `SELECT count(*) FROM model_calls WHERE user_id=$1 AND model_id=$2`, actor, id).Scan(&recorded); err != nil || recorded != 1 {
				t.Fatalf("usage %d %v", recorded, err)
			}
			if _, err = v.DescribeImage(ctx, other, id, "image/png", []byte("image-bytes")); err == nil {
				t.Fatal("unauthorized model accepted")
			}
			if _, err = pool.Exec(ctx, `UPDATE models SET advanced_config=jsonb_set(advanced_config,'{supports_vision}','false') WHERE id=$1`, id); err != nil {
				t.Fatal(err)
			}
			if _, err = v.DescribeImage(ctx, actor, id, "image/png", []byte("image-bytes")); err == nil {
				t.Fatal("non-vision model accepted")
			}
			if calls.Load() != 1 {
				t.Fatal("rejected request reached provider")
			}
		})
	}
}
