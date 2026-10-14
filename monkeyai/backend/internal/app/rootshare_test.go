package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRootGroupSharing(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 和 MONKEYAI_S3_* 运行根分组分享集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_root_shares_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
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
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	owner := resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'根分组分享所有者','root-share-owner@example.com','admin')`, owner); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte("a"))
	if _, err = pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,'root-share-owner-refresh',now()+interval '1 hour',now()+interval '2 hours')`, owner, hex.EncodeToString(hash[:])); err != nil {
		t.Fatal(err)
	}
	handler, err := newApplicationHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost:8080"})
	if err != nil {
		t.Fatal(err)
	}
	request := func(path, contentType string, body []byte) resource.Object {
		t.Helper()
		req := httptest.NewRequest("POST", "/api/v1/"+path, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer a")
		req.Header.Set("Content-Type", contentType)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != 201 {
			t.Fatalf("创建 %s: %d %s", path, w.Code, w.Body.String())
		}
		out := resource.Object{}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	create := func(kind string, input resource.Object) string {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return request(kind+"s", "application/json", body).String("id")
	}
	var archive bytes.Buffer
	zw := zip.NewWriter(&archive)
	file, err := zw.Create("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.WriteString(file, "---\nname: root-share\ndescription: Root group sharing test\n---\n测试技能"); err != nil {
		t.Fatal(err)
	}
	if err = zw.Close(); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	file, err = mw.CreateFormFile("package", "root-share.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write(archive.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = mw.Close(); err != nil {
		t.Fatal(err)
	}
	skillID := request("skills", mw.FormDataContentType(), body.Bytes()).String("id")
	ruleID := create("rule", resource.Object{"name": "根分组分享规则", "content": "测试规则"})
	resources := []resource.ShareResource{
		{Type: "model", ID: create("model", resource.Object{"model_id": "root-share", "display_name": "根分组分享模型", "protocol": "openai_chat_completions", "base_url": "https://example.com/v1", "api_key": "root-share-test-secret", "advanced_config": resource.Object{"context_window_tokens": 32000, "max_output_tokens": 4096}})},
		{Type: "rule", ID: ruleID},
		{Type: "skill", ID: skillID},
		{Type: "connector", ID: create("connector", resource.Object{"name": "根分组分享连接", "url": "https://example.com/mcp", "authorization_mode": "independent", "authorization_method": "http_header"})},
		{Type: "expert", ID: create("expert", resource.Object{"name": "根分组分享专家", "prompt": "测试专家", "rule_ids": []string{ruleID}, "skill_ids": []string{skillID}})},
	}
	testRootShares(t, pool, handler, owner, resources)
}

func testRootShares(t *testing.T, pool *pgxpool.Pool, handler http.Handler, owner string, resources []resource.ShareResource) {
	t.Helper()
	ctx := t.Context()
	call := func(method, path, token string, input any, want int) (resource.Object, string) {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d，预期 %d: %s", method, path, w.Code, want, w.Body.String())
		}
		out := resource.Object{}
		if w.Body.Len() > 0 {
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out, w.Header().Get("ETag")
	}
	createRecipient := func() (string, string) {
		t.Helper()
		id, token := resource.ID(), resource.ID()
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'根分组分享接收者',$2)`, id, id+"@example.com"); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM oauth_tokens WHERE user_id=$1`, id)
			_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, id)
		})
		hash := sha256.Sum256([]byte(token))
		if _, err := pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,$3,now()+interval '1 hour',now()+interval '2 hours')`, id, hex.EncodeToString(hash[:]), token); err != nil {
			t.Fatal(err)
		}
		return id, token
	}
	assertVisible := func(token string, want bool) {
		t.Helper()
		for _, item := range resources {
			kind := item.Type + "s"
			catalog, _ := call("GET", "/"+kind, token, nil, 200)
			found := false
			for _, raw := range catalog[kind].([]any) {
				entry := raw.(map[string]any)
				if entry["id"] == item.ID {
					found = true
					if entry["shared_groups"] != nil || entry["shared_users"] != nil || entry["ownership_type"] != "user" {
						t.Fatalf("接收者目录泄露授权信息或改变归属: %v", entry)
					}
					if item.Type == "rule" && entry["required"] != false {
						t.Fatalf("根分组分享的个人规则不能强制应用: %v", entry)
					}
				}
			}
			if found != want {
				t.Fatalf("%s 的根分组分享可见性=%v，预期 %v", item.Type, found, want)
			}
		}
	}
	rootName, err := rootgroup.Name(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	found, _ := call("GET", "/groups?q="+url.QueryEscape(strings.ToLower(rootName))+"&limit=1", "a", nil, 200)
	groups := found["groups"].([]any)
	if len(groups) != 1 {
		t.Fatalf("搜索未返回根分组: %v", found)
	}
	root := groups[0].(map[string]any)
	if len(root) != 3 || root["id"] != rootgroup.ID || root["name"] != rootName || root["parent_id"] != nil {
		t.Fatalf("根分组搜索回包错误: %v", root)
	}
	id, token := createRecipient()
	assertVisible(token, false)
	share := resource.ShareInput{Resources: resources, GroupIDs: []string{rootgroup.ID, rootgroup.ID}}
	call("POST", "/resources/shares", "a", resource.ShareInput{Resources: resources, GroupIDs: []string{rootgroup.ID, resource.ID()}}, 400)
	call("POST", "/resources/shares", "a", resource.ShareInput{Resources: resources, GroupIDs: share.GroupIDs, UserIDs: []string{owner}}, 400)
	assertVisible(token, false)
	before := map[string]string{}
	for _, item := range resources {
		_, before[item.ID] = call("GET", "/"+item.Type+"s", token, nil, 200)
	}
	call("POST", "/resources/shares", "a", share, 204)
	call("POST", "/resources/shares", "a", share, 204)
	assertVisible(token, true)
	for _, item := range resources {
		kind := item.Type + "s"
		detail, _ := call("GET", "/"+kind+"/"+item.ID, "a", nil, 200)
		catalog, _ := call("GET", "/"+kind, "a", nil, 200)
		for _, raw := range catalog[kind].([]any) {
			entry := resource.Object(raw.(map[string]any))
			if entry.String("id") != item.ID {
				continue
			}
			for _, o := range []resource.Object{detail, entry} {
				groups := o["shared_groups"].([]any)
				if len(groups) != 1 {
					t.Fatalf("%s 根分组分享未正确回显: %v", kind, o)
				}
				group := groups[0].(map[string]any)
				if group["id"] != rootgroup.ID || group["name"] != rootName || group["parent_id"] != nil {
					t.Fatalf("根分组展示信息错误: %v", group)
				}
			}
		}
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM resource_access_grants WHERE resource_type=$1 AND resource_id=$2 AND all_users AND user_id IS NULL AND group_id IS NULL AND access_level='read_only' AND usage_requirement='optional'`, item.Type, item.ID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("根分组分享未按全员只读授权幂等保存: %d %v", count, err)
		}
		_, after := call("GET", "/"+kind, token, nil, 200)
		if after == before[item.ID] {
			t.Fatalf("%s 根分组分享未更新接收者目录缓存", kind)
		}
		call("GET", "/"+kind+"/"+item.ID, token, nil, 404)
		if item.Type == "rule" {
			resolved, _ := call("POST", "/resources/resolve", token, resource.Object{"rule_ids": []string{item.ID}}, 200)
			rules := resolved["rules"].([]any)
			if len(rules) != 1 || rules[0].(map[string]any)["required"] != false {
				t.Fatalf("根分组分享规则不可选用或被强制应用: %v", resolved)
			}
		}
		if item.Type == "expert" {
			manifest, _ := call("GET", "/experts/"+item.ID+"/manifest", token, nil, 200)
			if !manifest.Bool("available") {
				t.Fatalf("根分组分享未授权专家依赖: %v", manifest)
			}
		}
	}
	call("POST", "/resources/shares", token, share, 404)
	call("DELETE", "/resources/shares", token, share, 404)
	_, laterToken := createRecipient()
	assertVisible(laterToken, true)
	if _, err := pool.Exec(ctx, `UPDATE users SET status='disabled' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	call("GET", "/"+resources[0].Type+"s", token, nil, 401)
	if _, err := pool.Exec(ctx, `UPDATE users SET status='active' WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	direct := resource.ShareInput{Resources: resources, UserIDs: []string{id}}
	call("POST", "/resources/shares", "a", direct, 204)
	call("DELETE", "/resources/shares", "a", share, 204)
	call("DELETE", "/resources/shares", "a", share, 204)
	assertVisible(token, true)
	assertVisible(laterToken, false)
	for _, item := range resources {
		detail, _ := call("GET", "/"+item.Type+"s/"+item.ID, "a", nil, 200)
		if len(detail["shared_groups"].([]any)) != 0 {
			t.Fatalf("撤销后仍回显根分组: %v", detail)
		}
		if item.Type != "model" {
			grants := detail["grants"].([]any)
			for _, raw := range grants {
				grant := raw.(map[string]any)
				if grant["group_id"] == rootgroup.ID {
					t.Fatalf("撤销后仍返回根分组授权: %v", grant)
				}
			}
		}
	}
	call("DELETE", "/resources/shares", "a", direct, 204)
	assertVisible(token, false)
	for _, item := range resources {
		if item.Type == "rule" {
			call("POST", "/resources/resolve", token, resource.Object{"rule_ids": []string{item.ID}}, 404)
		}
		if item.Type == "expert" {
			call("GET", "/experts/"+item.ID+"/manifest", token, nil, 404)
		}
	}
}
