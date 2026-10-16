package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEstimatedModelBilling(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行估算用量计费集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_estimate_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	user, model := resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'补算测试','estimate@example.com')`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id)
		VALUES($1,'system','补算模型','gpt-5','openai_chat_completions','https://example.com','test','{"context_window_tokens":10000,"max_output_tokens":100}',$2)`, model, user); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO settings(key,value,updated_by_user_id) VALUES('billing','{"root_credits":"10000"}',$1)`, user); err != nil {
		t.Fatal(err)
	}
	service := billing.NewService(pool)
	for _, tc := range []struct {
		name, response, status, amount, inputSource string
		stream                                      bool
		input                                       int64
	}{
		{"非流式补算", `{"id":"estimated","choices":[{"message":{"content":"hello world"}}]}`, "settled", "0.001700", "tokenizer:o200k_base", false, 9},
		{"保留上游零输入", `{"id":"estimated","usage":{"prompt_tokens":0},"choices":[{"message":{"content":"hello world"}}]}`, "settled", "0.000800", "", false, 0},
		{"流式补算", "data: {\"id\":\"estimated\",\"choices\":[{\"delta\":{\"content\":\"hello world\"}}]}\n\ndata: [DONE]\n\n", "settled", "0.001700", "tokenizer:o200k_base", true, 9},
		{"流中断保留未知状态", "data: {\"id\":\"estimated\",\"choices\":[{\"delta\":{\"content\":\"hello world\"}}]}\n\n", "unknown", "0.001700", "tokenizer:o200k_base", true, 9},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if tc.stream {
					w.Header().Set("Content-Type", "text/event-stream")
				}
				_, _ = io.WriteString(w, tc.response)
			}))
			t.Cleanup(upstream.Close)
			p := proxy.NewProxy(proxy.ResolverFunc(func(context.Context, string, string) (proxy.Target, error) {
				return proxy.Target{ModelID: model, UserID: user, UpstreamModel: "gpt-5", BaseURL: upstream.URL}, nil
			}), slog.New(slog.NewTextHandler(io.Discard, nil))).WithBilling(modelBilling{service: service})
			body := resource.Object{"model": model, "messages": []resource.Object{{"role": "user", "content": "hello world"}}, "stream": tc.stream}
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(encoded))
			r.Header.Set("Authorization", "Bearer test")
			w := httptest.NewRecorder()
			p.ServeHTTP(w, r)
			waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			if err := p.Wait(waitCtx); err != nil {
				t.Fatal(err)
			}
			if w.Code != http.StatusOK || w.Body.String() != tc.response {
				t.Fatalf("补算改变代理响应: %d %s", w.Code, w.Body.String())
			}
			id := w.Header().Get("X-Billing-Transaction-ID")
			var input, output int64
			var status, amount, inputSource, outputSource string
			if err := pool.QueryRow(ctx, `SELECT t.status,t.amount::text,c.input_tokens,c.output_tokens,
				coalesce(t.usage->>'input_source',''),coalesce(t.usage->>'output_source','')
				FROM billing_transactions t JOIN model_calls c ON c.id=t.id WHERE t.id=$1`, id).Scan(&status, &amount, &input, &output, &inputSource, &outputSource); err != nil {
				t.Fatal(err)
			}
			if status != tc.status || amount != tc.amount || input != tc.input || output != 2 || inputSource != tc.inputSource || outputSource != "tokenizer:o200k_base" {
				t.Fatalf("估算结算或持久化错误: status=%s amount=%s input=%d output=%d input_source=%s output_source=%s", status, amount, input, output, inputSource, outputSource)
			}
		})
	}
}
