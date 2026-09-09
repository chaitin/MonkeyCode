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
	"uuid"

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
	migrations, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range migrations {
		up, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(up)); err != nil {
			t.Fatal(err)
		}
	}
	storage, err := resource.NewS3(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	handler, err := newApplicationHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost:8080", AdminURL: "http://localhost:8080", InitialAdminName: "测试管理员", InitialAdminEmail: "resources@example.com", InitialAdminPassword: "resource-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	if err = storage.Ping(ctx); err != nil {
		t.Fatalf("应用启动后 Bucket 不可访问: %v", err)
	}
	if err = storage.Init(ctx); err != nil {
		t.Fatalf("重复初始化: %v", err)
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
		assertNoIdentifiers(t, out)
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
	invokeKeys := map[string]string{}
	for _, name := range []string{"a", "b"} {
		invokeKeys[name] = must("POST", "/api/v1/api-keys", resource.Object{"name": "MCP 测试", "scopes": []string{"mcp:invoke"}}, name, "").String("api_key")
	}
	t.Run("用户模型与批量分享", func(t *testing.T) { testModelSharing(t, pool, handler, users) })
	t.Run("独立资源目录", func(t *testing.T) {
		for _, kind := range []string{"settings", "models", "rules", "skills", "experts", "connectors"} {
			path := "/api/v1/" + kind
			if code, _, _ := call("GET", path, nil, "", ""); code != 401 {
				t.Fatalf("%s 未校验 Agent 身份: %d", path, code)
			}
			code, out, headers := call("GET", path, nil, "a", "")
			fields := 2
			if kind == "models" {
				fields = 3
				gateway := out["model_gateway"].(map[string]any)
				if gateway["base_url"] != "http://localhost:8080/v1" || gateway["authentication"] != "api_key" {
					t.Fatalf("模型代理配置缺失: %v", out)
				}
			}
			if code != 200 || len(out) != fields || out[kind] == nil || out.String("version") == "" {
				t.Fatalf("%s 包含无关资源或缺少目录: %d %v", path, code, out)
			}
			if kind != "settings" && len(out[kind].([]any)) != 0 {
				t.Fatalf("初始目录应为空数组: %v", out)
			}
			req := httptest.NewRequest("GET", path, nil)
			req.Header.Set("Authorization", "Bearer a")
			req.Header.Set("If-None-Match", headers.Get("ETag"))
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != 304 || w.Body.Len() != 0 {
				t.Fatalf("%s 未命中独立缓存: %d %s", path, w.Code, w.Body.String())
			}
		}
		if code, _, _ := call("GET", "/api/v1/config", nil, "a", ""); code != 404 {
			t.Fatalf("整体配置入口仍然可用: %d", code)
		}
	})
	t.Run("资源读取失败隔离", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `ALTER TABLE connectors RENAME TO unavailable_connectors`); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := pool.Exec(ctx, `ALTER TABLE unavailable_connectors RENAME TO connectors`); err != nil {
				t.Fatal(err)
			}
		}()
		for _, kind := range []string{"settings", "models", "rules", "skills", "experts", "connectors"} {
			want := 200
			if kind == "experts" || kind == "connectors" {
				want = 500
			}
			if code, _, _ := call("GET", "/api/v1/"+kind, nil, "a", ""); code != want {
				t.Fatalf("%s 读取状态 = %d，预期 %d", kind, code, want)
			}
		}
	})
	for _, body := range []string{"null", "{} {}", "[]"} {
		request := httptest.NewRequest("POST", "/api/admin/v1/rules", strings.NewReader(body))
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 400 {
			t.Fatalf("无效 JSON 应返回 400: %s: %d", body, response.Code)
		}
	}
	t.Run("固定查询保留缺省字段与显式空值", func(t *testing.T) {
		input := resource.Object{"name": "字段更新测试", "url": "https://example.com/mcp", "authorization_mode": "none", "description": "保留描述", "enabled": false}
		provider := must("POST", "/api/admin/v1/connector-providers", input, "", "")
		path := "/api/admin/v1/connector-providers/" + provider.String("id")
		if _, ok := provider["identifier"]; ok {
			t.Fatal("连接模板响应不应暴露内部标识")
		}
		var identifier string
		if err := pool.QueryRow(ctx, "SELECT identifier FROM connector_providers WHERE id=$1", provider.String("id")).Scan(&identifier); err != nil {
			t.Fatal(err)
		}
		if _, err := uuid.Parse(identifier); err != nil {
			t.Fatalf("内部标识应为服务端生成的 UUID: %v", err)
		}
		if provider.Bool("enabled") || provider["authorization_method"] != nil {
			t.Fatalf("创建字段错误: %v", provider)
		}
		input["description"] = nil
		input["name"] = "不应保存"
		if code, _, _ := call("PUT", path, input, "", `"1"`); code < 400 {
			t.Fatalf("显式 null 应触发非空约束: %d", code)
		}
		current := must("GET", path, nil, "", "")
		if current.String("name") != "字段更新测试" || current.Int("revision") != 1 {
			t.Fatalf("失败更新未回滚: %v", current)
		}
		delete(input, "description")
		delete(input, "enabled")
		input["name"] = "有效更新"
		input["identifier"] = "client-supplied"
		current = must("PUT", path, input, "", `"1"`)
		var updatedIdentifier string
		if err := pool.QueryRow(ctx, "SELECT identifier FROM connector_providers WHERE id=$1", provider.String("id")).Scan(&updatedIdentifier); err != nil || updatedIdentifier != identifier {
			t.Fatalf("更新连接模板不应改变内部标识: %v", err)
		}
		if _, ok := current["identifier"]; ok {
			t.Fatal("更新响应不应暴露内部标识")
		}
		if current.String("description") != "保留描述" || current.Bool("enabled") || current.Int("revision") != 2 {
			t.Fatalf("未传字段不应被覆盖: %v", current)
		}
		if code, _, _ := call("DELETE", path, nil, "", `"2"`); code != 204 {
			t.Fatalf("清理测试 Provider 失败: %d", code)
		}
	})
	t.Run("提交失败不得返回成功", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `
CREATE FUNCTION reject_test_tag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.name='提交失败测试' THEN RAISE EXCEPTION '测试事务提交失败'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER reject_test_tag AFTER INSERT ON tags
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_test_tag();`); err != nil {
			t.Fatal(err)
		}
		if code, _, _ := call("POST", "/api/admin/v1/tags", resource.Object{"name": "提交失败测试"}, "", ""); code != 500 {
			t.Fatalf("提交失败应返回 500: %d", code)
		}
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM tags WHERE name='提交失败测试'`).Scan(&count); err != nil || count != 0 {
			t.Fatalf("失败事务不应留下数据: count=%d err=%v", count, err)
		}
	})
	grantA := []resource.Object{{"user_id": users[0], "usage_requirement": "optional"}}
	rule := must("POST", "/api/admin/v1/rules", resource.Object{"name": "规则", "content": "规则正文", "grants": grantA}, "", "")
	if code, _, _ := call("PUT", "/api/admin/v1/rules/"+rule.String("id"), resource.Object{"name": "规则", "content": "覆盖"}, "", `"99"`); code != 412 {
		t.Fatalf("应拒绝过期修订: %d", code)
	}
	snapshot := must("GET", "/api/v1/rules", nil, "a", "")
	before := snapshot.String("version")
	if len(snapshot["rules"].([]any)) != 1 {
		t.Fatalf("授权规则缺失: %v", snapshot)
	}
	b := must("GET", "/api/v1/rules", nil, "b", "")
	if len(b["rules"].([]any)) != 0 {
		t.Fatal("规则越权")
	}
	req := httptest.NewRequest("GET", "/api/v1/rules", nil)
	req.Header.Set("Authorization", "Bearer a")
	req.Header.Set("If-None-Match", `"`+before+`"`)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 304 {
		t.Fatalf("规则目录应返回 304: %d %s", w.Code, w.Body.String())
	}
	otherVersions := map[string]string{}
	for _, kind := range []string{"settings", "models", "skills", "experts", "connectors"} {
		otherVersions[kind] = must("GET", "/api/v1/"+kind, nil, "a", "").String("version")
	}
	rule = must("PUT", "/api/admin/v1/rules/"+rule.String("id"), resource.Object{"name": "规则", "content": "更新正文", "grants": grantA}, "", `"1"`)
	after := must("GET", "/api/v1/rules", nil, "a", "")
	if before == after.String("version") {
		t.Fatal("正文变化未更新版本")
	}
	for kind, version := range otherVersions {
		if got := must("GET", "/api/v1/"+kind, nil, "a", "").String("version"); got != version {
			t.Fatalf("无关规则变化影响 %s 版本", kind)
		}
	}
	must("PUT", "/api/admin/v1/rules/"+rule.String("id"), resource.Object{"name": "规则", "content": "更新正文", "grants": []any{}}, "", `"2"`)
	revoked := must("GET", "/api/v1/rules", nil, "a", "")
	if len(revoked["rules"].([]any)) != 0 || revoked.String("version") == after.String("version") {
		t.Fatal("撤销规则授权未更新目录及版本")
	}
	rule = must("PUT", "/api/admin/v1/rules/"+rule.String("id"), resource.Object{"name": "规则", "content": "更新正文", "grants": grantA}, "", `"3"`)
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
	experts := must("GET", "/api/v1/experts", nil, "a", "")
	if items := experts["experts"].([]any); len(items) != 1 || items[0].(map[string]any)["id"] != expert.String("id") {
		t.Fatalf("专家目录缺失授权项: %v", experts)
	}
	if items := must("GET", "/api/v1/experts", nil, "b", "")["experts"].([]any); len(items) != 0 {
		t.Fatal("专家目录越权")
	}
	if items := must("GET", "/api/v1/skills", nil, "a", "")["skills"].([]any); len(items) != 0 {
		t.Fatal("专家委托不应扩散到独立技能目录")
	}
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
	if updated := must("GET", "/api/v1/experts", nil, "a", ""); updated.String("version") == experts.String("version") {
		t.Fatal("技能包更新未改变依赖它的专家目录版本")
	}
	must("PUT", "/api/admin/v1/resources/skill/"+skill.String("id")+"/grants", resource.Object{"grants": grantA}, "", `"2"`)
	skills := must("GET", "/api/v1/skills", nil, "a", "")
	if items := skills["skills"].([]any); len(items) != 1 {
		t.Fatalf("技能目录缺失授权项: %v", skills)
	} else {
		item := items[0].(map[string]any)
		if item["id"] != skill.String("id") || item["package_sha256"] != skill.String("package_sha256") || len(item["tags"].([]any)) != 1 || !strings.Contains(item["download_path"].(string), skill.String("package_sha256")) {
			t.Fatalf("技能目录元数据缺失: %v", item)
		}
	}
	must("PUT", "/api/admin/v1/resources/skill/"+skill.String("id")+"/grants", resource.Object{"grants": []any{}}, "", `"3"`)
	if revoked := must("GET", "/api/v1/skills", nil, "a", ""); len(revoked["skills"].([]any)) != 0 || revoked.String("version") == skills.String("version") {
		t.Fatal("技能撤权后目录及版本未更新")
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
	provider := must("POST", "/api/admin/v1/connector-providers", resource.Object{"name": "测试 MCP", "description": "测试", "url": upstream.URL, "authorization_mode": "none"}, "", "")
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
	must("PATCH", "/api/admin/v1/connectors/"+conn.String("id")+"/tools/"+tool.String("id"), resource.Object{"enabled": true, "credits_per_call": "0"}, "", "")
	agentTools := must("GET", "/api/v1/connectors/"+conn.String("id")+"/tools", nil, "a", "")
	if len(agentTools["items"].([]any)) != 1 {
		t.Fatal("启用工具下发失败")
	}
	if code, _, _ := call("GET", "/api/v1/connectors/"+conn.String("id")+"/tools", nil, "b", ""); code != 404 {
		t.Fatalf("工具目录越权: %d", code)
	}
	t.Run("MCP 协议与资源授权", func(t *testing.T) {
		gateway := "/mcp/connectors/" + conn.String("id")
		for _, version := range []string{"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2099-01-01"} {
			out := must("POST", gateway, resource.Object{"jsonrpc": "2.0", "id": "init", "method": "initialize", "params": resource.Object{"protocolVersion": version}}, invokeKeys["a"], "")
			want := version
			if version == "2099-01-01" {
				want = "2025-11-25"
			}
			if out.String("id") != "init" || out["result"].(map[string]any)["protocolVersion"] != want {
				t.Fatalf("版本协商错误: %v", out)
			}
		}
		for _, method := range []string{"notifications/initialized", "notifications/cancelled", "tools/call"} {
			code, out, h := call("POST", gateway, resource.Object{"jsonrpc": "2.0", "method": method}, invokeKeys["a"], "")
			if code != 202 || len(out) != 0 || h.Get("X-Billing-Transaction-ID") != "" {
				t.Fatalf("通知不应执行或返回响应: %d %v", code, out)
			}
		}
		in := resource.Object{"jsonrpc": "2.0", "id": "list", "method": "tools/list"}
		for _, test := range []struct {
			token  string
			status int
		}{{"a", 401}, {invokeKeys["b"], 404}, {"", 401}} {
			if code, _, _ := call("POST", gateway, in, test.token, ""); code != test.status {
				t.Fatalf("身份或资源授权失效: %d", code)
			}
		}
		modelKey := must("POST", "/api/v1/api-keys", resource.Object{"name": "模型专用", "scopes": []string{"model:invoke"}}, "a", "").String("api_key")
		if code, _, _ := call("POST", gateway, in, modelKey, ""); code != 401 {
			t.Fatal("模型密钥越权调用 MCP")
		}
		out := must("POST", gateway, in, invokeKeys["a"], "")
		if len(out["result"].(map[string]any)["tools"].([]any)) != 1 {
			t.Fatalf("代理目录缺失: %v", out)
		}
		must("PATCH", "/api/admin/v1/connectors/"+conn.String("id")+"/tools/"+tool.String("id"), resource.Object{"enabled": false, "credits_per_call": "0"}, "", "")
		out = must("POST", gateway, in, invokeKeys["a"], "")
		if len(out["result"].(map[string]any)["tools"].([]any)) != 0 {
			t.Fatal("禁用工具仍被暴露")
		}
		out = must("POST", gateway, resource.Object{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": resource.Object{"name": "ExactTool"}}, invokeKeys["a"], "")
		if out["error"].(map[string]any)["code"] != float64(-32602) {
			t.Fatal("禁用工具仍可执行")
		}
		must("PATCH", "/api/admin/v1/connectors/"+conn.String("id")+"/tools/"+tool.String("id"), resource.Object{"enabled": true, "credits_per_call": "0"}, "", "")
		out = must("POST", gateway, resource.Object{"jsonrpc": "2.0", "id": "unknown", "method": "resources/list"}, invokeKeys["a"], "")
		if out["error"].(map[string]any)["code"] != float64(-32601) {
			t.Fatal("未支持的方法应返回协议错误")
		}
		catalog := must("GET", "/api/v1/connectors", nil, "a", "")
		entry := catalog["connectors"].([]any)[0].(map[string]any)
		proxy := entry["mcp_gateway"].(map[string]any)
		if proxy["url"] != "http://localhost:8080"+gateway || proxy["transport"] != "streamable_http" || proxy["required_scope"] != "mcp:invoke" || len(entry["capabilities"].([]any)) != 2 {
			t.Fatalf("未下发可执行代理: %v", entry)
		}
		if _, err := pool.Exec(ctx, `UPDATE connector_providers SET enabled=false WHERE id=$1`, provider.String("id")); err != nil {
			t.Fatal(err)
		}
		if code, _, _ := call("POST", gateway, in, invokeKeys["a"], ""); code != 404 {
			t.Fatal("禁用模板仍可代理")
		}
		if _, err := pool.Exec(ctx, `UPDATE connector_providers SET enabled=true WHERE id=$1`, provider.String("id")); err != nil {
			t.Fatal(err)
		}
	})
	allGroup := must("POST", "/api/admin/v1/groups", resource.Object{"name": "资源测试组", "parent_id": nil}, "", "")
	must("PUT", "/api/admin/v1/groups/"+allGroup.String("id")+"/members", resource.Object{"member_ids": users}, "", "")
	must("POST", "/api/admin/v1/rules", resource.Object{"name": "强制规则", "content": "强制", "grants": []resource.Object{{"group_id": allGroup.String("id"), "usage_requirement": "required"}}}, "", "")
	resolved = must("POST", "/api/v1/resources/resolve", resource.Object{}, "b", "")
	if len(resolved["rules"].([]any)) != 1 {
		t.Fatal("显式分组的强制规则缺失")
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
			_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": resource.Object{"protocolVersion": "2025-03-26"}})
		case "notifications/initialized":
			w.WriteHeader(202)
		case "tools/list":
			_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": resource.Object{"tools": []resource.Object{{"name": r.Header.Get("X-Account"), "description": "Account tool", "inputSchema": resource.Object{"type": "object"}}}}})
		}
	}))
	defer independent.Close()
	p2 := must("POST", "/api/admin/v1/connector-providers", resource.Object{"name": "独立 MCP", "url": independent.URL, "authorization_mode": "independent", "authorization_method": "http_header"}, "", "")
	c2 := must("POST", "/api/admin/v1/connectors", resource.Object{"name": "独立连接", "description": "按用户隔离", "provider_id": p2.String("id"), "grants": []resource.Object{{"group_id": allGroup.String("id"), "usage_requirement": "optional"}}}, "", "")
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
		must("PATCH", "/api/admin/v1/connectors/"+c2.String("id")+"/tools/"+tool.String("id"), resource.Object{"enabled": true, "credits_per_call": "0"}, "", "")
	}
	for _, name := range []string{"a", "b"} {
		directory := must("GET", "/api/v1/connectors/"+c2.String("id")+"/tools", nil, name, "")
		encoded, _ := json.Marshal(directory)
		if strings.Contains(string(encoded), "credential_id") || len(directory["items"].([]any)) != 1 {
			t.Fatal("用户工具目录泄露认证元信息或缺失")
		}
	}
	for _, name := range []string{"a", "b"} {
		out := must("POST", "/mcp/connectors/"+c2.String("id"), resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, invokeKeys[name], "")
		tools := out["result"].(map[string]any)["tools"].([]any)
		if len(tools) != 1 || tools[0].(map[string]any)["name"] != "Tool-"+name {
			t.Fatal("独立凭证代理目录串用")
		}
	}
	must("DELETE", "/api/v1/connectors/"+c2.String("id")+"/credential", nil, "a", "")
	if code, _, _ := call("POST", "/mcp/connectors/"+c2.String("id"), resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, invokeKeys["a"], ""); code != 403 {
		t.Fatal("撤销凭证后代理仍可使用")
	}

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
	p3 := must("POST", "/api/admin/v1/connector-providers", resource.Object{"name": "OAuth MCP", "url": upstream.URL, "authorization_mode": "centralized", "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": oauthServer.URL + "/authorize", "token_url": oauthServer.URL + "/token", "client_id": "test-client"}, "oauth_client_secret": "private-client-secret"}, "", "")
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
	must("POST", "/api/admin/v1/connectors/"+c3.String("id")+"/test", nil, "", "")
	oauthTools := must("GET", "/api/admin/v1/connectors/"+c3.String("id")+"/tools", nil, "", "")["items"].([]any)
	oauthTool := resource.Object(oauthTools[0].(map[string]any))
	must("PATCH", "/api/admin/v1/connectors/"+c3.String("id")+"/tools/"+oauthTool.String("id"), resource.Object{"enabled": true, "credits_per_call": "0"}, "", "")
	if _, err := pool.Exec(ctx, `UPDATE connector_credentials SET oauth_access_token='expired-token',oauth_expires_at=now()-interval '1 minute' WHERE connector_id=$1`, c3.String("id")); err != nil {
		t.Fatal(err)
	}
	refreshable := must("GET", "/api/v1/connectors", nil, "a", "")
	for _, raw := range refreshable["connectors"].([]any) {
		entry := resource.Object(raw.(map[string]any))
		if entry.String("id") == c3.String("id") && (entry.String("authorization_status") != "authorized" || len(entry["tools"].([]any)) != 1) {
			t.Fatal("可自动刷新的 OAuth 凭证不应要求手工重新授权")
		}
	}
	refreshed := must("POST", "/mcp/connectors/"+c3.String("id"), resource.Object{"jsonrpc": "2.0", "id": "oauth", "method": "tools/list"}, invokeKeys["a"], "")
	if refreshed["result"] == nil {
		t.Fatalf("OAuth 自动刷新失败: %v", refreshed)
	}
	var fresh bool
	if err := pool.QueryRow(ctx, `SELECT oauth_access_token='private-oauth-token' AND oauth_expires_at>now() FROM connector_credentials WHERE connector_id=$1`, c3.String("id")).Scan(&fresh); err != nil || !fresh {
		t.Fatalf("刷新凭证未持久化: %v", err)
	}
	snap := must("GET", "/api/v1/connectors", nil, "a", "")
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
	if _, err = pool.Exec(ctx, `INSERT INTO groups(id,parent_id,name) VALUES($1,NULL,'测试父分组'),($2,$1,'测试子分组')`, parentID, childID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)`, childID, users[0], adminUser.String("id")); err != nil {
		t.Fatal(err)
	}
	inherited := must("POST", "/api/admin/v1/rules", resource.Object{"name": "继承规则", "content": "继承", "grants": []resource.Object{{"group_id": parentID, "usage_requirement": "optional"}}}, "", "")
	hasRule := func(token, id string) bool {
		snap := must("GET", "/api/v1/rules", nil, token, "")
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

	t.Run("全员授权保存回显下发与撤销", func(t *testing.T) {
		all := []resource.Object{{"all_users": true, "usage_requirement": "optional"}}
		item := must("POST", "/api/admin/v1/rules", resource.Object{"name": "全员规则", "content": "全员规则正文", "grants": all}, "", "")
		id := item.String("id")
		path := "/api/admin/v1/resources/rule/" + id + "/grants"
		stored := must("GET", path, nil, "", "")
		storedGrants := stored["grants"].([]any)
		if len(storedGrants) != 1 {
			t.Fatalf("全员授权记录数量错误: %v", stored)
		}
		grant := resource.Object(storedGrants[0].(map[string]any))
		if !grant.Bool("all_users") || grant["user_id"] != nil || grant["group_id"] != nil {
			t.Fatalf("全员授权不应引用用户或虚拟分组: %v", grant)
		}
		for _, token := range []string{"a", "b"} {
			if !hasRule(token, id) {
				t.Fatal("已有用户未获得全员规则")
			}
		}
		newUser := resource.ID()
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'新成员','all-users-new@example.com')`, newUser); err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256([]byte("all-users-new"))
		if _, err := pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,'all-users-new',now()+interval '1 hour',now()+interval '2 hours')`, newUser, hex.EncodeToString(hash[:])); err != nil {
			t.Fatal(err)
		}
		if !hasRule("all-users-new", id) {
			t.Fatal("新增且未分组的用户未获得全员规则")
		}
		allowed, err := resource.Allowed(ctx, pool, "rule", id, newUser)
		if err != nil || !allowed {
			t.Fatalf("直接资源访问未识别全员授权: %v", err)
		}
		allowed, err = resource.Allowed(ctx, pool, "rule", id, resource.ID())
		if err != nil || allowed {
			t.Fatalf("全员授权不应覆盖不存在的用户: %v", err)
		}
		for _, invalid := range []resource.Object{
			{"all_users": true, "user_id": users[0]},
			{"all_users": true, "group_id": childID},
			{"all_users": false},
		} {
			code, _, _ := call("PUT", path, resource.Object{"grants": []resource.Object{invalid}}, "", `"1"`)
			if code != 400 || !hasRule("all-users-new", id) {
				t.Fatalf("无效授权未拒绝或破坏了原授权: %d", code)
			}
		}
		must("PUT", path, resource.Object{"grants": []resource.Object{
			{"all_users": true, "usage_requirement": "optional"},
			{"user_id": users[0], "usage_requirement": "required"},
		}}, "", `"1"`)
		for _, token := range []string{"a", "all-users-new"} {
			result := must("GET", "/api/v1/rules", nil, token, "")
			for _, raw := range result["rules"].([]any) {
				rule := resource.Object(raw.(map[string]any))
				if rule.String("id") == id && rule.Bool("required") != (token == "a") {
					t.Fatalf("全员可用和部分用户强制的范围混淆: %v", rule)
				}
			}
		}
		must("PUT", path, resource.Object{"grants": []resource.Object{{"all_users": true, "usage_requirement": "required"}}}, "", `"2"`)
		resolved := must("POST", "/api/v1/resources/resolve", resource.Object{}, "all-users-new", "")
		if len(resolved["rules"].([]any)) != 1 || resolved["rules"].([]any)[0].(map[string]any)["id"] != id {
			t.Fatalf("新增用户未获得全员强制规则: %v", resolved)
		}
		must("PUT", path, resource.Object{"grants": []any{}}, "", `"3"`)
		if hasRule("a", id) || hasRule("all-users-new", id) {
			t.Fatal("撤销全员授权后仍下发规则")
		}
		allowed, err = resource.Allowed(ctx, pool, "rule", id, newUser)
		if err != nil || allowed {
			t.Fatalf("直接资源访问未撤销: %v", err)
		}
		must("DELETE", "/api/admin/v1/rules/"+id, nil, "", `"4"`)
	})

	t.Run("个人资源创作与分享", func(t *testing.T) { testPersonalResources(t, pool, handler, users) })

	// 虚拟根的数据转换不可逆；可丢弃测试库从初始结构重建。
	for i := len(migrations) - 1; i >= 0; i-- {
		if filepath.Base(migrations[i]) == "000003_group_virtual_root.up.sql" {
			continue
		}
		down, err := os.ReadFile(strings.Replace(migrations[i], ".up.sql", ".down.sql", 1))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(down)); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range migrations {
		up, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(up)); err != nil {
			t.Fatal(err)
		}
	}
	var tables int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema=$1 AND table_name IN('oauth_tokens','oauth_login_states','api_keys','connectors')`, schema).Scan(&tables); err != nil || tables != 4 {
		t.Fatal("重新初始化缺少必要表")
	}
}

func assertNoIdentifiers(t *testing.T, value any) {
	t.Helper()
	switch v := value.(type) {
	case resource.Object:
		assertNoIdentifiers(t, map[string]any(v))
	case map[string]any:
		for key, child := range v {
			if key == "identifier" || key == "provider_identifier" {
				t.Fatalf("API 响应不应暴露内部字段 %s", key)
			}
			assertNoIdentifiers(t, child)
		}
	case []any:
		for _, child := range v {
			assertNoIdentifiers(t, child)
		}
	}
}
