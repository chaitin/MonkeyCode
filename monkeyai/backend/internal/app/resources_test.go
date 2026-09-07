package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestResourceIntegration(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 和 MONKEYAI_S3_* 运行 PostgreSQL / RustFS 集成测试")
	}
	ctx := context.Background()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "test_resources_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	up, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000001_initial_create_schema.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	storage, err := resource.NewS3(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = storage.Init(ctx); err != nil {
		t.Fatal(err)
	}
	if err = storage.Init(ctx); err != nil {
		t.Fatalf("重复初始化: %v", err)
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	handler, err := newApplicationHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost:8080", AdminURL: "http://localhost:8080", InitialAdminName: "测试管理员", InitialAdminEmail: "resources@example.com", InitialAdminPassword: "resource-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	var cookie *http.Cookie
	call := func(method, path string, body any, token, revision string) (int, resource.Object, http.Header) {
		t.Helper()
		var b []byte
		if body != nil {
			b, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if revision != "" {
			req.Header.Set("If-Match", revision)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if method == "POST" && path == "/api/auth/v1/admin/login" {
			cookies := w.Result().Cookies()
			if len(cookies) > 0 {
				cookie = cookies[0]
			}
		}
		out := resource.Object{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out, w.Header()
	}
	must := func(method, path string, body any, token, rev string) resource.Object {
		t.Helper()
		code, o, _ := call(method, path, body, token, rev)
		if code < 200 || code > 299 {
			t.Fatalf("%s %s: %d %v", method, path, code, o)
		}
		return o
	}
	must("POST", "/api/auth/v1/admin/login", resource.Object{"email": "resources@example.com", "password": "resource-test-password"}, "", "")
	users := []string{}
	for _, name := range []string{"a", "b"} {
		id := resource.ID()
		if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,$2,$3)`, id, name, name+"@example.com"); err != nil {
			t.Fatal(err)
		}
		h := sha256.Sum256([]byte(name))
		if _, err = pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,$3,now()+interval '1 hour',now()+interval '2 hours')`, id, hex.EncodeToString(h[:]), name); err != nil {
			t.Fatal(err)
		}
		users = append(users, id)
	}
	for _, body := range []string{"null", "{} {}", "[]"} {
		request := httptest.NewRequest("POST", "/api/admin/v1/rules", strings.NewReader(body))
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 400 {
			t.Fatalf("无效 JSON 应返回 400: %s: %d", body, response.Code)
		}
	}
	grantA := []resource.Object{{"user_id": users[0], "usage_requirement": "optional"}}
	rule := must("POST", "/api/admin/v1/rules", resource.Object{"name": "规则", "content": "规则正文", "grants": grantA}, "", "")
	if code, _, _ := call("PUT", "/api/admin/v1/rules/"+rule.String("id"), resource.Object{"name": "规则", "content": "覆盖"}, "", `"99"`); code != 412 {
		t.Fatalf("应拒绝过期修订: %d", code)
	}
	snapshot := must("GET", "/api/v1/config", nil, "a", "")
	before := snapshot.String("version")
	if len(snapshot["rules"].([]any)) != 1 {
		t.Fatalf("授权规则缺失: %v", snapshot)
	}
	b := must("GET", "/api/v1/config", nil, "b", "")
	if len(b["rules"].([]any)) != 0 {
		t.Fatal("规则越权")
	}
	req := httptest.NewRequest("GET", "/api/v1/config", nil)
	req.Header.Set("Authorization", "Bearer a")
	req.Header.Set("If-None-Match", `"`+before+`"`)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 304 {
		t.Fatalf("配置应返回 304: %d %s", w.Code, w.Body.String())
	}
	rule = must("PUT", "/api/admin/v1/rules/"+rule.String("id"), resource.Object{"name": "规则", "content": "更新正文", "grants": grantA}, "", `"1"`)
	after := must("GET", "/api/v1/config", nil, "a", "")
	if before == after.String("version") {
		t.Fatal("正文变化未更新版本")
	}
	tag := must("POST", "/api/admin/v1/tags", resource.Object{"name": "测试标签"}, "", "")
	var archive bytes.Buffer
	z := zip.NewWriter(&archive)
	f, _ := z.Create("review/SKILL.md")
	_, _ = f.Write([]byte("---\nname: review\ndescription: Review code\n---\n原始正文\n"))
	f, _ = z.Create("review/scripts/check.sh")
	_, _ = f.Write([]byte("echo check"))
	_ = z.Close()
	var form bytes.Buffer
	mp := multipart.NewWriter(&form)
	part, _ := mp.CreateFormFile("package", "review.zip")
	_, _ = part.Write(archive.Bytes())
	meta, _ := json.Marshal(resource.Object{"grants": []any{}, "tag_ids": []string{tag.String("id")}})
	_ = mp.WriteField("metadata", string(meta))
	_ = mp.Close()
	req = httptest.NewRequest("POST", "/api/admin/v1/skills", &form)
	req.Header.Set("Content-Type", mp.FormDataContentType())
	req.AddCookie(cookie)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("技能上传失败: %d %s", w.Code, w.Body.String())
	}
	var skill resource.Object
	_ = json.Unmarshal(w.Body.Bytes(), &skill)
	if _, err = pool.Exec(ctx, `UPDATE skills SET package_sha256=$2 WHERE id=$1`, skill.String("id"), strings.Repeat("0", 64)); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"/package", "/manifest"} {
		if code, _, _ := call("GET", "/api/admin/v1/skills/"+skill.String("id")+suffix, nil, "", ""); code != 502 {
			t.Fatalf("损坏技能不得下载或编辑: %s: %d", suffix, code)
		}
	}
	if _, err = pool.Exec(ctx, `UPDATE skills SET package_sha256=$2 WHERE id=$1`, skill.String("id"), skill.String("package_sha256")); err != nil {
		t.Fatal(err)
	}

	expert := must("POST", "/api/admin/v1/experts", resource.Object{"name": "专家", "description": "测试", "prompt": "审查代码", "rule_ids": []string{rule.String("id")}, "skill_ids": []string{skill.String("id")}, "providers": []any{}, "grants": grantA}, "", "")
	must("GET", "/api/v1/experts/"+expert.String("id")+"/manifest", nil, "a", "")
	if code, _, _ := call("GET", "/api/v1/skills/"+skill.String("id")+"/package", nil, "a", ""); code != 404 {
		t.Fatalf("委托不应扩散独立访问: %d", code)
	}
	must("GET", "/api/v1/experts/"+expert.String("id")+"/skills/"+skill.String("id")+"/package?sha256="+skill.String("package_sha256"), nil, "a", "")
	if code, _, _ := call("DELETE", "/api/admin/v1/rules/"+rule.String("id"), nil, "", fmt.Sprintf(`"%d"`, rule.Int("revision"))); code != 409 {
		t.Fatalf("应阻止引用删除: %d", code)
	}
	skill = must("PUT", "/api/admin/v1/skills/"+skill.String("id"), resource.Object{"name": "review", "description": "New description", "content": "更新正文", "tag_ids": []string{tag.String("id")}}, "", `"1"`)
	manifest := must("GET", "/api/admin/v1/skills/"+skill.String("id")+"/manifest", nil, "", "")
	if manifest.String("content") != "更新正文" {
		t.Fatal("包正文未更新")
	}
	must("POST", "/api/admin/v1/experts/"+expert.String("id")+"/copy", resource.Object{"name": "专家副本"}, "", "")
	resolved := must("POST", "/api/v1/resources/resolve", resource.Object{"expert_id": expert.String("id")}, "a", "")
	if len(resolved["skills"].([]any)) != 1 {
		t.Fatal("专家技能装配失败")
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		w.Header().Set("Content-Type", "application/json")
		switch in.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": resource.Object{"protocolVersion": "2025-03-26", "capabilities": resource.Object{}, "serverInfo": resource.Object{"name": "test", "version": "1"}}})
		case "notifications/initialized":
			w.WriteHeader(202)
		case "tools/list":
			_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": resource.Object{"tools": []resource.Object{{"name": "ExactTool", "description": "A tool", "inputSchema": resource.Object{"type": "object"}}}}})
		}
	}))
	defer upstream.Close()
	provider := must("POST", "/api/admin/v1/connector-providers", resource.Object{"name": "测试 MCP", "identifier": "test-mcp", "description": "测试", "url": upstream.URL, "authorization_mode": "none"}, "", "")
	var iconBytes bytes.Buffer
	if err := png.Encode(&iconBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	var iconForm bytes.Buffer
	iconWriter := multipart.NewWriter(&iconForm)
	iconPart, _ := iconWriter.CreateFormFile("icon", "icon.png")
	_, _ = iconPart.Write(iconBytes.Bytes())
	_ = iconWriter.Close()
	iconRequest := httptest.NewRequest("PUT", "/api/admin/v1/connector-providers/"+provider.String("id")+"/icon", &iconForm)
	iconRequest.Header.Set("Content-Type", iconWriter.FormDataContentType())
	iconRequest.Header.Set("If-Match", `"1"`)
	iconRequest.AddCookie(cookie)
	iconResponse := httptest.NewRecorder()
	handler.ServeHTTP(iconResponse, iconRequest)
	if iconResponse.Code != 200 {
		t.Fatalf("图标上传失败: %d %s", iconResponse.Code, iconResponse.Body.String())
	}
	if strings.Contains(iconResponse.Body.String(), "icon_s3_key") {
		t.Fatal("图标响应不应包含内部存储 key")
	}

	conn := must("POST", "/api/admin/v1/connectors", resource.Object{"name": "测试连接", "description": "测试", "provider_id": provider.String("id"), "grants": grantA}, "", "")
	must("GET", "/api/v1/connectors/"+conn.String("id")+"/icon", nil, "a", "")
	if status, _, _ := call("GET", "/api/v1/connectors/"+conn.String("id")+"/icon", nil, "b", ""); status != 404 {
		t.Fatal("图标接口越权")
	}

	must("POST", "/api/admin/v1/connectors/"+conn.String("id")+"/test", nil, "", "")
	tools := must("GET", "/api/admin/v1/connectors/"+conn.String("id")+"/tools", nil, "", "")
	list := tools["items"].([]any)
	if len(list) != 1 {
		t.Fatalf("工具发现失败: %v", tools)
	}
	tool := resource.Object(list[0].(map[string]any))
	if tool.Bool("enabled") {
		t.Fatal("新工具必须默认禁用")
	}
	must("PATCH", "/api/admin/v1/connectors/"+conn.String("id")+"/tools/"+tool.String("id"), resource.Object{"enabled": true, "credits_per_call": 2.5}, "", "")
	agentTools := must("GET", "/api/v1/connectors/"+conn.String("id")+"/tools", nil, "a", "")
	if len(agentTools["items"].([]any)) != 1 {
		t.Fatal("启用工具下发失败")
	}
	if code, _, _ := call("GET", "/api/v1/connectors/"+conn.String("id")+"/tools", nil, "b", ""); code != 404 {
		t.Fatalf("工具目录越权: %d", code)
	}
	rootRule := must("POST", "/api/admin/v1/rules", resource.Object{"name": "强制规则", "content": "强制", "grants": []resource.Object{{"group_id": "00000000-0000-0000-0000-000000000001", "usage_requirement": "required"}}}, "", "")
	_ = rootRule
	resolved = must("POST", "/api/v1/resources/resolve", resource.Object{}, "b", "")
	if len(resolved["rules"].([]any)) != 1 {
		t.Fatal("根组强制规则缺失")
	}
	must("PUT", "/api/admin/v1/experts/"+expert.String("id"), resource.Object{"name": "专家", "description": "测试", "prompt": "审查代码", "rule_ids": []string{rule.String("id")}, "skill_ids": []string{skill.String("id")}, "providers": []any{}, "grants": []any{}}, "", `"1"`)
	if code, _, _ := call("GET", "/api/v1/experts/"+expert.String("id")+"/skills/"+skill.String("id")+"/package", nil, "a", ""); code != 404 {
		t.Fatal("撤权后委托下载仍可用")
	}
	// 同一个独立认证实例的用户目录相互隔离；凭证更新后旧目录不可下发。
	independent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			ID     int    `json:"id"`
			Method string `json:"method"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		w.Header().Set("Content-Type", "application/json")
		switch in.Method {
		case "initialize":
			_ = json.NewEncoder(w).Encode(resource.Object{"id": in.ID, "result": resource.Object{"protocolVersion": "2025-03-26"}})
		case "notifications/initialized":
			w.WriteHeader(202)
		case "tools/list":
			_ = json.NewEncoder(w).Encode(resource.Object{"id": in.ID, "result": resource.Object{"tools": []resource.Object{{"name": r.Header.Get("X-Account"), "description": "Account tool", "inputSchema": resource.Object{"type": "object"}}}}})
		}
	}))
	defer independent.Close()
	p2 := must("POST", "/api/admin/v1/connector-providers", resource.Object{"name": "独立 MCP", "identifier": "independent", "url": independent.URL, "authorization_mode": "independent", "authorization_method": "http_header"}, "", "")
	c2 := must("POST", "/api/admin/v1/connectors", resource.Object{"name": "独立连接", "description": "按用户隔离", "provider_id": p2.String("id"), "grants": []resource.Object{{"group_id": "00000000-0000-0000-0000-000000000001", "usage_requirement": "optional"}}}, "", "")
	for i, name := range []string{"a", "b"} {
		must("PUT", "/api/v1/connectors/"+c2.String("id")+"/credential", resource.Object{"http_headers": resource.Object{"X-Account": "Tool-" + name}}, name, "")
		must("POST", "/api/v1/connectors/"+c2.String("id")+"/test", nil, name, "")
		directory := must("GET", "/api/admin/v1/connectors/"+c2.String("id")+"/tools?user_id="+users[i], nil, "", "")
		items := directory["items"].([]any)
		if len(items) != 1 {
			t.Fatal("认证目录未隔离")
		}
		tool := resource.Object(items[0].(map[string]any))
		if tool.String("name") != "Tool-"+name {
			t.Fatal("账号工具串用")
		}
		must("PATCH", "/api/admin/v1/connectors/"+c2.String("id")+"/tools/"+tool.String("id"), resource.Object{"enabled": true, "credits_per_call": 1}, "", "")
	}
	for _, name := range []string{"a", "b"} {
		directory := must("GET", "/api/v1/connectors/"+c2.String("id")+"/tools", nil, name, "")
		encoded, _ := json.Marshal(directory)
		if strings.Contains(string(encoded), "credential_id") || len(directory["items"].([]any)) != 1 {
			t.Fatal("用户工具目录泄露认证元信息或缺失")
		}
	}
	must("DELETE", "/api/v1/connectors/"+c2.String("id")+"/credential", nil, "a", "")
	directory := must("GET", "/api/v1/connectors/"+c2.String("id")+"/tools", nil, "a", "")
	if len(directory["items"].([]any)) != 0 {
		t.Fatal("撤销凭证后工具仍可用")
	}
	// OAuth 回调绑定 state/PKCE，只能消费一次，Token 只存服务端。
	oauthServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("code_verifier") == "" && r.Form.Get("grant_type") == "authorization_code" {
			http.Error(w, "missing pkce", 400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"access_token":"private-oauth-token","refresh_token":"private-refresh-token","token_type":"Bearer","expires_in":3600}`)
	}))
	defer oauthServer.Close()
	p3 := must("POST", "/api/admin/v1/connector-providers", resource.Object{"name": "OAuth MCP", "identifier": "oauth-test", "url": upstream.URL, "authorization_mode": "centralized", "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": oauthServer.URL + "/authorize", "token_url": oauthServer.URL + "/token", "client_id": "test-client"}, "oauth_client_secret": "private-client-secret"}, "", "")
	c3 := must("POST", "/api/admin/v1/connectors", resource.Object{"name": "OAuth 连接", "provider_id": p3.String("id"), "grants": grantA}, "", "")
	auth := must("POST", "/api/admin/v1/connectors/"+c3.String("id")+"/oauth/authorizations", nil, "", "")
	target, err := url.Parse(auth.String("authorization_url"))
	if err != nil || target.Query().Get("code_challenge") == "" {
		t.Fatal("未生成 PKCE")
	}
	callback := "/oauth/connectors/callback?state=" + url.QueryEscape(target.Query().Get("state")) + "&code=test-code"
	must("GET", callback, nil, "", "")
	if code, _, _ := call("GET", callback, nil, "", ""); code != 400 {
		t.Fatalf("OAuth callback 可重放: %d", code)
	}
	status := must("GET", "/api/admin/v1/connector-authorizations/"+auth.String("id"), nil, "", "")
	if status.String("status") != "authorized" {
		t.Fatal("OAuth 状态未落库")
	}
	snap := must("GET", "/api/v1/config", nil, "a", "")
	encoded, _ := json.Marshal(snap)
	if strings.Contains(string(encoded), "private-") {
		t.Fatal("下发泄露凭据")
	}

	page := must("GET", "/api/admin/v1/rules?limit=1", nil, "", "")
	if len(page["items"].([]any)) != 1 || page.String("next_cursor") == "" {
		t.Fatal("列表分页无效")
	}
	next := must("GET", "/api/admin/v1/rules?limit=1&cursor="+page.String("next_cursor"), nil, "", "")
	if len(next["items"].([]any)) != 1 {
		t.Fatal("下一页缺失")
	}

	// 父分组授权覆盖后代成员，删除父分组后不再继承失效授权。
	adminUser := must("GET", "/api/admin/v1/me", nil, "", "")
	parentID, childID := resource.ID(), resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO groups(id,parent_id,name) VALUES($1,'00000000-0000-0000-0000-000000000001','测试父分组'),($2,$1,'测试子分组')`, parentID, childID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)`, childID, users[0], adminUser.String("id")); err != nil {
		t.Fatal(err)
	}
	inherited := must("POST", "/api/admin/v1/rules", resource.Object{"name": "继承规则", "content": "继承", "grants": []resource.Object{{"group_id": parentID, "usage_requirement": "optional"}}}, "", "")
	hasRule := func(token, id string) bool {
		snap := must("GET", "/api/v1/config", nil, token, "")
		for _, raw := range snap["rules"].([]any) {
			if raw.(map[string]any)["id"] == id {
				return true
			}
		}
		return false
	}
	if !hasRule("a", inherited.String("id")) || hasRule("b", inherited.String("id")) {
		t.Fatal("父子分组授权解析错误")
	}
	if _, err = pool.Exec(ctx, `UPDATE groups SET deleted_at=now() WHERE id=$1`, parentID); err != nil {
		t.Fatal(err)
	}
	if hasRule("a", inherited.String("id")) {
		t.Fatal("仍继承已删除分组的授权")
	}

	// 一版迁移可以完整撤销并重建，保留身份和调用密钥结构。
	down, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000001_initial_create_schema.down.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(down)); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	var tables int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema=$1 AND table_name IN('oauth_tokens','oauth_login_states','api_keys','connectors')`, schema).Scan(&tables); err != nil || tables != 4 {
		t.Fatal("重新初始化缺少必要表")
	}
}
