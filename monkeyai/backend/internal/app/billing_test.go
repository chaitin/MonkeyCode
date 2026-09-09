package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestBillingIntegration(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要 PostgreSQL 与 RustFS 测试环境")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_billing_http_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	paths, _ := filepath.Glob("../../migrations/*.up.sql")
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	handler, err := newApplicationHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost:8080", AdminURL: "http://localhost:8080", InitialAdminName: "计费测试", InitialAdminEmail: "billing-http@example.com", InitialAdminPassword: "billing-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	var cookie *http.Cookie
	call := func(method, path string, body any, token, key string) (int, resource.Object, http.Header) {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			r.AddCookie(cookie)
		}
		if token == "" && strings.HasPrefix(path, "/api/v1/") {
			token = "billing-oauth-test"
		}
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if path == "/api/auth/v1/admin/login" && len(w.Result().Cookies()) > 0 {
			cookie = w.Result().Cookies()[0]
		}
		out := resource.Object{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out, w.Header()
	}
	must := func(method, path string, body any, token string) resource.Object {
		t.Helper()
		code, out, _ := call(method, path, body, token, "")
		if code < 200 || code >= 300 {
			t.Fatalf("%s %s: %d %v", method, path, code, out)
		}
		return out
	}
	if code, _, _ := call("GET", "/api/admin/v1/billing/settings", nil, "", ""); code != 401 {
		t.Fatalf("匿名管理接口: %d", code)
	}
	for _, path := range []string{"realtime", "models", "tasks", "history"} {
		if code, _, _ := call("GET", "/api/admin/v1/statistics/"+path, nil, "", ""); code != 401 {
			t.Fatalf("匿名统计接口 %s: %d", path, code)
		}
	}

	must("POST", "/api/auth/v1/admin/login", resource.Object{"email": "billing-http@example.com", "password": "billing-test-password"}, "")
	if code, _, _ := call("POST", "/api/admin/v1/identifiers", resource.Object{"count": 1}, "", ""); code != 404 {
		t.Fatalf("不应注册标识分配接口: %d", code)
	}
	var user string
	if err = pool.QueryRow(ctx, `SELECT id FROM users WHERE email='billing-http@example.com'`).Scan(&user); err != nil {
		t.Fatal(err)
	}
	groups := must("GET", "/api/admin/v1/groups", nil, "")
	if len(groups["groups"].([]any)) != 0 {
		t.Fatal("启动应用不应初始化分组")
	}
	quotas := must("GET", "/api/admin/v1/billing/quotas", nil, "")
	team := resource.Object(quotas["groups"].([]any)[0].(map[string]any))
	if team.String("id") != "team" || team["parent_id"] != nil {
		t.Fatalf("团队额度根节点: %v", team)
	}
	must("PUT", "/api/admin/v1/billing/quotas", resource.Object{"revision": quotas.Int("revision"), "changes": []resource.Object{{"subject_type": "group", "id": "team", "credits": "12345"}}}, "")
	updated := must("GET", "/api/admin/v1/billing/quotas", nil, "")
	if resource.Object(updated["users"].([]any)[0].(map[string]any)).String("effective_credits") != "12345" {
		t.Fatalf("团队额度继承: %v", updated)
	}
	top := must("POST", "/api/admin/v1/groups", resource.Object{"name": "研发", "parent_id": nil}, "")
	if top["parent_id"] != nil {
		t.Fatalf("顶层分组入库父级不为 null: %v", top)
	}
	must("PATCH", "/api/admin/v1/groups/"+top.String("id"), resource.Object{"name": "研发组"}, "")
	must("PUT", "/api/admin/v1/groups/"+top.String("id")+"/members", resource.Object{"member_ids": []string{user}}, "")
	must("PUT", "/api/admin/v1/users/"+user+"/billing-group", resource.Object{"group_id": top.String("id")}, "")
	if code, _, _ := call("DELETE", "/api/admin/v1/groups/"+top.String("id"), nil, "", ""); code != 409 {
		t.Fatalf("计费归属引用应阻止删除: %d", code)
	}
	must("PUT", "/api/admin/v1/users/"+user+"/billing-group", resource.Object{"group_id": nil}, "")
	must("DELETE", "/api/admin/v1/groups/"+top.String("id"), nil, "")
	hash := sha256.Sum256([]byte("billing-oauth-test"))
	if _, err = pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,'billing-refresh',now()+interval '1 hour',now()+interval '2 hours')`, user, hex.EncodeToString(hash[:])); err != nil {
		t.Fatal(err)
	}

	key := must("POST", "/api/v1/api-keys", resource.Object{"name": "计费调用", "scopes": []string{"model:invoke", "mcp:invoke"}}, "").String("api_key")
	settings := must("GET", "/api/admin/v1/billing/settings", nil, "")
	revision := resource.Object(settings["policy"].(map[string]any)).Int("revision")
	must("PATCH", "/api/admin/v1/billing/settings/mode", resource.Object{"revision": revision, "charging_mode": "local", "enabled": true}, "")
	if code, _, _ := call("PATCH", "/api/admin/v1/billing/settings/cycle", resource.Object{"revision": revision, "quota_refresh_cycle": "daily"}, "", ""); code != 409 {
		t.Fatalf("旧版本应拒绝: %d", code)
	}
	var requests atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body resource.Object
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.Int("max_completion_tokens") != 2000 {
			t.Errorf("未限制输出: %v", body)
		}
		if body.String("model") != "billing-model" {
			t.Errorf("上游模型名错误: %v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"upstream-reused-id","usage":{"prompt_tokens":10000,"completion_tokens":2000,"prompt_tokens_details":{"cached_tokens":4000}}}`)
	}))
	defer upstream.Close()
	model := must("POST", "/api/admin/v1/models", resource.Object{"model_id": "billing-model", "display_name": "计费模型", "protocol": "openai_chat_completions", "base_url": upstream.URL, "api_key": "test-key", "advanced_config": resource.Object{"context_window_tokens": 20000, "max_output_tokens": 2000}, "credit_multiplier": 1, "authorization": resource.Object{"user_ids": []string{user}, "group_ids": []string{}}}, "")
	catalog := must("GET", "/api/v1/models", nil, "")["models"].([]any)
	if len(catalog) != 1 {
		t.Fatalf("模型目录错误: %v", catalog)
	}
	agentModel := resource.Object(catalog[0].(map[string]any))
	body := resource.Object{"model": agentModel.String("model"), "messages": []resource.Object{{"role": "user", "content": "测试"}}}
	code, out, headers := call("POST", "/v1/chat/completions", body, key, "http-call-1")
	if code != 200 {
		t.Fatalf("模型调用: %d %v", code, out)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err = handler.(*applicationHandler).proxy.Wait(waitCtx); err != nil {
		t.Fatal(err)
	}
	transaction := headers.Get("X-Billing-Transaction-ID")
	detail := must("GET", "/api/admin/v1/billing/transactions/"+transaction, nil, "")
	if detail.String("status") != "settled" || detail.String("amount") != "1.480000" {
		t.Fatalf("结算错误: %v", detail)
	}
	var recordedModel string
	if err := pool.QueryRow(ctx, `SELECT model_id FROM model_calls WHERE id=$1`, transaction).Scan(&recordedModel); err != nil || recordedModel != model.String("id") {
		t.Fatalf("模型调用记录未使用主键 UUID: %s, %v", recordedModel, err)
	}
	body["model"] = model.String("id")
	if code, _, _ := call("POST", "/v1/chat/completions", body, key, "http-call-1"); code != 409 || requests.Load() != 1 {
		t.Fatalf("重复执行: %d %d", code, requests.Load())
	}
	must("POST", "/api/admin/v1/billing/transactions/"+transaction+"/refund", resource.Object{"reason": "验证退款"}, "")
	must("POST", "/api/admin/v1/billing/transactions/"+transaction+"/refund", resource.Object{"reason": "验证退款"}, "")
	summary := must("GET", "/api/admin/v1/billing/summary", nil, "")
	if summary.String("charges") != "1.480000" || summary.String("refunds") != "1.480000" {
		t.Fatalf("退款重复或丢失: %v", summary)
	}
	accountPath := "/api/admin/v1/billing/accounts/" + user
	accountVersion := func() any {
		t.Helper()
		return must("GET", accountPath, nil, "")["account"].(map[string]any)["version"]
	}
	must("POST", accountPath+"/adjustments", resource.Object{"delta": "-14999", "reason": "验证额度限制", "version": accountVersion()}, "")
	if code, _, _ := call("POST", "/v1/chat/completions", body, key, ""); code != 402 || requests.Load() != 1 {
		t.Fatalf("余额不足仍调用上游: %d %d", code, requests.Load())
	}
	must("GET", "/api/admin/v1/billing/entries?user=计费&category=model&page_size=1", nil, "")
	reconciliation := must("GET", "/api/admin/v1/billing/reconciliation", nil, "")
	if len(reconciliation["differences"].([]any)) != 0 {
		t.Fatalf("账目不平: %v", reconciliation)
	}
	// MCP 通过真实鉴权、目录和工具执行入口验证成功收费、业务失败不收费。
	adjustment := resource.Object{"delta": "100", "reason": "工具测试", "version": accountVersion()}
	adjustPath := "/api/admin/v1/billing/accounts/" + user + "/adjustments"
	adjusted := must("POST", adjustPath, adjustment, "")
	retried := must("POST", adjustPath, adjustment, "")
	if adjusted["account"].(map[string]any)["balance"] != retried["account"].(map[string]any)["balance"] {
		t.Fatal("同一账户版本重试不应重复调整余额")
	}
	adjustment["delta"] = "200"
	if code, _, _ := call("POST", adjustPath, adjustment, "", ""); code != 409 {
		t.Fatalf("同一账户版本提交不同调整内容应冲突: %d", code)
	}
	if adjusted["account"].(map[string]any)["version"] == adjustment["version"] {
		t.Fatal("记账后账户版本应变化")
	}
	if code, _, _ := call("POST", adjustPath, resource.Object{"delta": "100", "reason": "缺少版本"}, "", ""); code != 400 {
		t.Fatalf("缺少账户版本应拒绝: %d", code)
	}
	if code, _, _ := call("POST", adjustPath, resource.Object{"delta": "100", "reason": "过期版本", "version": "stale"}, "", ""); code != 412 {
		t.Fatalf("过期账户版本应拒绝: %d", code)
	}
	// 余额回到原值后，新的账本版本仍应允许相同内容的下一次调整。
	must("POST", adjustPath, resource.Object{"delta": "-100", "reason": "恢复余额", "version": accountVersion()}, "")
	adjustment["delta"] = "100"
	adjustment["version"] = accountVersion()
	type adjustmentResult struct {
		status int
		body   resource.Object
	}
	results := make(chan adjustmentResult, 2)
	for range 2 {
		go func() {
			status, body, _ := call("POST", adjustPath, adjustment, "", "")
			results <- adjustmentResult{status, body}
		}()
	}
	for range 2 {
		result := <-results
		if result.status != 200 {
			t.Fatalf("并发重试调整失败: %d %v", result.status, result.body)
		}
		if result.body["account"].(map[string]any)["balance"] != adjusted["account"].(map[string]any)["balance"] {
			t.Fatal("新版本的相同内容并发提交应只记账一次")
		}
	}
	var toolCalls atomic.Int64
	mcpUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
			Params struct {
				Meta      json.RawMessage `json:"_meta"`
				Arguments struct {
					Fail   bool        `json:"fail"`
					Format string      `json:"format"`
					Value  json.Number `json:"value"`
				} `json:"arguments"`
			} `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		var result any = resource.Object{}
		switch in.Method {
		case "initialize":
			result = resource.Object{"protocolVersion": "2025-03-26"}
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			result = resource.Object{"tools": []resource.Object{{"name": "search", "inputSchema": resource.Object{"type": "object"}}}}
		case "tools/call":
			toolCalls.Add(1)
			if in.Params.Arguments.Value != "" && (in.Params.Arguments.Value != "9007199254740993" || !bytes.Contains(in.Params.Meta, []byte("request-trace"))) {
				t.Error("代理改变参数精度或丢失元数据")
			}
			switch in.Params.Arguments.Format {
			case "rpc":
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "error": resource.Object{"code": -32602, "message": "private-upstream-error"}})
				return
			case "invalid":
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": resource.Object{}})
				return
			case "sse":
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"content\":[]}}\n\n")
				return
			}
			result = resource.Object{"content": []resource.Object{{"type": "text", "text": "结果"}}, "isError": in.Params.Arguments.Fail}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}))
	defer mcpUpstream.Close()
	for _, mode := range []string{"centralized", "independent", "none"} {
		provider := must("POST", "/api/admin/v1/connector-providers", resource.Object{"name": "计费工具-" + mode, "url": mcpUpstream.URL, "authorization_mode": mode, "authorization_method": "http_header"}, "")
		connector := must("POST", "/api/admin/v1/connectors", resource.Object{"name": "连接-" + mode, "description": "测试", "provider_id": provider.String("id"), "grants": []resource.Object{{"user_id": user, "usage_requirement": "optional"}}}, "")
		path := "/api/admin/v1/connectors/" + connector.String("id")
		if mode != "none" {
			credentialPath := path + "/credential"
			if mode == "independent" {
				credentialPath = "/api/v1/connectors/" + connector.String("id") + "/credential"
			}
			must("PUT", credentialPath, resource.Object{"http_headers": resource.Object{"X-Test": "billing"}}, "")
		}
		testPath := path + "/test"
		if mode == "independent" {
			testPath = "/api/v1/connectors/" + connector.String("id") + "/test"
		}
		must("POST", testPath, nil, "")
		toolsPath := path + "/tools"
		if mode == "independent" {
			toolsPath += "?user_id=" + user
		}
		list := must("GET", toolsPath, nil, "")["items"].([]any)
		tool := resource.Object(list[0].(map[string]any))
		cost := "0"
		if mode == "centralized" {
			cost = "2.5"
		}
		must("PATCH", path+"/tools/"+tool.String("id"), resource.Object{"enabled": true, "credits_per_call": cost}, "")
		for _, failed := range []bool{false, true} {
			_, _, h := call("POST", "/mcp/connectors/"+connector.String("id"), resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": "search", "arguments": resource.Object{"fail": failed}}}, key, "")
			id := h.Get("X-Billing-Transaction-ID")
			if id == "" {
				t.Fatalf("MCP %s 缺少交易", mode)
			}
			detail := must("GET", "/api/admin/v1/billing/transactions/"+id, nil, "")
			want := "0.000000"
			if mode == "centralized" && !failed {
				want = "2.500000"
			}
			if detail.String("amount") != want {
				t.Fatalf("MCP %s %t: %v", mode, failed, detail)
			}
		}
		if mode == "centralized" {
			gateway := "/mcp/connectors/" + connector.String("id")
			request := resource.Object{"jsonrpc": "2.0", "id": "client-call", "method": "tools/call", "params": json.RawMessage(`{"name":"search","arguments":{"value":9007199254740993},"_meta":{"trace":"request-trace"}}`)}
			code, out, first := call("POST", gateway, request, key, "mcp-once")
			if code != 200 || out.String("id") != "client-call" || out["result"] == nil {
				t.Fatalf("工具调用结果错误: %d %v", code, out)
			}
			count := toolCalls.Load()
			request["params"] = json.RawMessage(`{"_meta":{"trace":"request-trace"},"arguments":{"value":9007199254740993},"name":"search"}`)
			code, duplicateResult, duplicate := call("POST", gateway, request, key, "mcp-once")
			if code != 409 || toolCalls.Load() != count || duplicate.Get("X-Billing-Transaction-ID") != first.Get("X-Billing-Transaction-ID") {
				t.Fatal("幂等请求重复调用或丢失交易 ID")
			}
			if duplicateResult["error"].(map[string]any)["data"].(map[string]any)["code"] != "request_already_accepted" {
				t.Fatal("JSON 字段顺序不应引起幂等冲突")
			}
			for _, test := range []struct{ format, status, amount string }{{"rpc", "released", "0.000000"}, {"sse", "settled", "2.500000"}, {"invalid", "unknown", "0.000000"}} {
				request["params"] = resource.Object{"name": "search", "arguments": resource.Object{"format": test.format}}
				code, out, headers := call("POST", gateway, request, key, "")
				id := headers.Get("X-Billing-Transaction-ID")
				if code != 200 || id == "" {
					t.Fatalf("MCP 结果分类失败: %d %v", code, out)
				}
				detail := must("GET", "/api/admin/v1/billing/transactions/"+id, nil, "")
				if detail.String("status") != test.status || detail.String("amount") != test.amount {
					t.Fatalf("%s 结算错误: %v", test.format, detail)
				}
				encoded, _ := json.Marshal(out)
				if strings.Contains(string(encoded), "private-upstream-error") {
					t.Fatal("上游协议错误泄露内部详情")
				}
				if test.format == "invalid" && out["error"] == nil {
					t.Fatal("无效结果被当作成功返回")
				}
			}
		}

	}
	reconciliation = must("GET", "/api/admin/v1/billing/reconciliation", nil, "")
	if len(reconciliation["differences"].([]any)) != 0 || reconciliation.Int("total") != 1 {
		t.Fatalf("MCP 账目不平: %v", reconciliation)
	}
	if reconciliation["items"].([]any)[0].(map[string]any)["error_code"] != "mcp_invalid_result" {
		t.Fatalf("无效结果未保留供核查: %v", reconciliation)
	}
	modelStats := must("GET", "/api/admin/v1/statistics/models?range=24h", nil, "")
	if modelStats["summary"].(map[string]any)["calls"].(float64) == 0 {
		t.Fatal("真实模型调用未进入统计")
	}
	for _, path := range []string{"realtime", "tasks", "history"} {
		must("GET", "/api/admin/v1/statistics/"+path, nil, "")
	}
	savedCookie := cookie
	cookie = nil
	if code, _, _ := call("GET", "/api/admin/v1/statistics/models", nil, "billing-oauth-test", ""); code != 401 {
		t.Fatalf("Agent token 不应获得管理统计: %d", code)
	}
	cookie = savedCookie

	t.Run("用户模型不计费", func(t *testing.T) {
		personal := must("POST", "/api/v1/models", resource.Object{"model_id": "billing-model", "display_name": "自定义模型", "protocol": "openai_chat_completions", "base_url": upstream.URL, "api_key": "test-key", "advanced_config": resource.Object{"context_window_tokens": 20000, "max_output_tokens": 2000}}, "")
		application := handler.(*applicationHandler)
		for _, mode := range []string{"local", "remote"} {
			if _, err := pool.Exec(ctx, `UPDATE settings SET value=value || jsonb_build_object('charging_mode',$1::text) WHERE key='billing'`, mode); err != nil {
				t.Fatal(err)
			}
			before, err := application.billing.Account(ctx, user)
			if err != nil {
				t.Fatal(err)
			}
			code, out, headers := call("POST", "/v1/chat/completions", resource.Object{"model": personal.String("id"), "messages": []resource.Object{{"role": "user", "content": "hi"}}, "max_completion_tokens": 2000}, key, "user-model-"+mode)
			if code != 200 {
				t.Fatalf("%s 用户模型调用失败: %d %v", mode, code, out)
			}
			waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = application.proxy.Wait(waitCtx)
			cancel()
			if err != nil {
				t.Fatal(err)
			}
			detail := must("GET", "/api/admin/v1/billing/transactions/"+headers.Get("X-Billing-Transaction-ID"), nil, "")
			if detail.String("status") != "settled" || detail.String("amount") != "0.000000" || detail.String("mode") != "local" {
				t.Fatalf("%s 用户模型应按零费用结算: %v", mode, detail)
			}
			after, err := application.billing.Account(ctx, user)
			if err != nil || after.Balance != before.Balance || after.Frozen != before.Frozen {
				t.Fatalf("%s 用户模型改变了积分: before=%+v after=%+v err=%v", mode, before, after, err)
			}
		}
	})
}
