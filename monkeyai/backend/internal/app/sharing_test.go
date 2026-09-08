package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testModelSharing(t *testing.T, pool *pgxpool.Pool, handler http.Handler, users []string) {
	ctx := t.Context()
	repo := model.NewPostgres(pool)
	adminID := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'分享测试管理员','sharing-admin@example.com','admin')`, adminID); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte("sharing-admin"))
	if _, err := pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,'sharing-admin-refresh',now()+interval '1 hour',now()+interval '2 hours')`, adminID, hex.EncodeToString(hash[:])); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, token string, input any, want int) (resource.Object, http.Header) {
		t.Helper()
		b, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(b))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, w.Code, want, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "upstream-test-secret") {
			t.Fatal("响应泄露上游密钥")
		}
		out := resource.Object{}
		if w.Code != 204 {
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out, w.Header()
	}
	input := resource.Object{
		"model_id": "upstream-model", "display_name": "我的模型", "protocol": "openai_chat_completions",
		"base_url": "https://example.com/v1", "api_key": "upstream-test-secret",
		"advanced_config": resource.Object{"context_window_tokens": 32000, "max_output_tokens": 4096, "supports_vision": true},
		"ownership_type":  "system", "owner_user_id": users[1], "credit_multiplier": 999,
		"authorization": resource.Object{"user_ids": []string{users[1]}},
	}
	call("POST", "/models", "", input, 401)
	call("GET", "/users?q=example", "", nil, 401)
	call("POST", "/resources/shares", "", resource.Object{}, 401)
	for _, value := range []string{"null", "{} {}", "[]"} {
		req := httptest.NewRequest("POST", "/api/v1/models", strings.NewReader(value))
		req.Header.Set("Authorization", "Bearer a")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != 400 {
			t.Fatalf("无效 JSON %s: %d", value, w.Code)
		}
	}
	first, _ := call("POST", "/models", "a", input, 201)
	second, _ := call("POST", "/models", "a", input, 201)
	ids := []string{first.String("id"), second.String("id")}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM resource_access_grants WHERE resource_type='model' AND resource_id::text=ANY($1)`, ids)
		_, _ = pool.Exec(context.Background(), `DELETE FROM models WHERE id::text=ANY($1)`, ids)
	})
	if first.String("ownership_type") != "user" || first.String("owner_user_id") != users[0] || first["credit_multiplier"] != float64(1) {
		t.Fatalf("模型归属或倍率可被伪造: %v", first)
	}
	assertAccess := func(user, id string, allowed bool) {
		t.Helper()
		_, err := repo.Resolve(ctx, user, id)
		if allowed && err != nil || !allowed && !errors.Is(err, model.ErrUnauthorized) {
			t.Fatalf("调用权限 user=%s allowed=%v: %v", user, allowed, err)
		}
	}
	assertAccess(users[0], ids[0], true)
	assertAccess(users[1], ids[0], false)
	assertAccess(adminID, ids[0], false)
	parentGroup, childGroup := resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO groups(id,parent_id,name) VALUES($1,NULL,'模型测试组'),($2,$1,'模型测试子组')`, parentGroup, childGroup); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,group_id,access_level,granted_by_user_id) VALUES('model',$1,$2,'read_only',$3)`, ids[0], parentGroup, users[0]); err != nil {
		t.Fatal(err)
	}
	assertAccess(users[1], ids[0], false)
	assertAccess(adminID, ids[0], false)
	assertGroupModels := func(want int) {
		t.Helper()
		available, err := repo.ListAvailable(ctx, users[1], false)
		if err != nil || len(available) != want {
			t.Fatalf("分组模型可见数=%d，预期 %d，err=%v", len(available), want, err)
		}
	}
	assertGroupModels(0)
	if _, err := pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)`, childGroup, users[1], adminID); err != nil {
		t.Fatal(err)
	}
	assertAccess(users[1], ids[0], true)
	assertGroupModels(1)
	if _, err := pool.Exec(ctx, `UPDATE groups SET parent_id=NULL WHERE id=$1`, childGroup); err != nil {
		t.Fatal(err)
	}
	assertAccess(users[1], ids[0], false)
	assertGroupModels(0)
	if _, err := pool.Exec(ctx, `DELETE FROM resource_access_grants WHERE group_id=$1`, parentGroup); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM group_users WHERE group_id=$1`, childGroup); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM groups WHERE id=ANY($1::uuid[])`, []string{parentGroup, childGroup}); err != nil {
		t.Fatal(err)
	}
	call("GET", "/models/"+ids[0], "b", nil, 404)
	call("PUT", "/models/"+ids[0], "b", input, 404)
	call("DELETE", "/models/"+ids[0], "sharing-admin", nil, 404)
	call("DELETE", "/models/"+ids[0], "b", nil, 404)
	call("GET", "/models/not-a-uuid", "a", nil, 400)
	call("GET", "/users", "a", nil, 400)
	call("GET", "/users?q=example&limit=101", "a", nil, 400)
	found, _ := call("GET", "/users?q=B%40EXAMPLE.COM", "a", nil, 200)
	if list := found["users"].([]any); len(list) != 1 || list[0].(map[string]any)["id"] != users[1] {
		t.Fatalf("邮箱查找: %v", found)
	}
	found, _ = call("GET", "/users?q=%E5%88%86%E4%BA%AB%E6%B5%8B%E8%AF%95", "a", nil, 200)
	if len(found["users"].([]any)) != 1 {
		t.Fatalf("用户名查找: %v", found)
	}
	found, _ = call("GET", "/users?q=%25", "a", nil, 200)
	if len(found["users"].([]any)) != 0 {
		t.Fatal("搜索不应解释通配符")
	}
	beforeA, headA := call("GET", "/models", "a", nil, 200)
	beforeB, headB := call("GET", "/models", "b", nil, 200)
	if len(beforeB["models"].([]any)) != 0 {
		t.Fatal("未分享的模型可见")
	}
	for _, raw := range beforeA["models"].([]any) {
		entry := raw.(map[string]any)
		if entry["ownership_type"] != "user" || len(entry["shared_users"].([]any)) != 0 || entry["creator"] != nil {
			t.Fatalf("自有模型元数据: %v", entry)
		}
	}
	share := resource.ShareInput{Resources: []resource.ShareResource{{Type: "model", ID: ids[0]}, {Type: "model", ID: ids[1]}}, UserIDs: []string{users[1], users[1]}}
	call("POST", "/resources/shares", "b", resource.ShareInput{Resources: share.Resources, UserIDs: []string{adminID}}, 404)
	invalid := resource.ShareInput{Resources: share.Resources, UserIDs: []string{users[1], resource.ID()}}
	call("POST", "/resources/shares", "a", invalid, 400)
	assertAccess(users[1], ids[0], false)
	invalid = resource.ShareInput{Resources: append([]resource.ShareResource{{Type: "model", ID: resource.ID()}}, share.Resources...), UserIDs: []string{users[1]}}
	call("POST", "/resources/shares", "a", invalid, 404)
	assertAccess(users[1], ids[0], false)
	call("POST", "/resources/shares", "a", resource.ShareInput{Resources: share.Resources, UserIDs: []string{users[0]}}, 400)
	call("POST", "/resources/shares", "a", resource.ShareInput{Resources: []resource.ShareResource{{Type: "skill", ID: ids[0]}}, UserIDs: []string{users[1]}}, 400)
	call("POST", "/resources/shares", "a", share, 204)
	call("POST", "/resources/shares", "a", share, 204)
	afterA, newHeadA := call("GET", "/models", "a", nil, 200)
	afterB, newHeadB := call("GET", "/models", "b", nil, 200)
	if headA.Get("ETag") == newHeadA.Get("ETag") || headB.Get("ETag") == newHeadB.Get("ETag") {
		t.Fatal("分享后模型目录 ETag 未变化")
	}
	if len(afterB["models"].([]any)) != 2 {
		t.Fatalf("批量分享缺失: %v", afterB)
	}
	for _, raw := range afterA["models"].([]any) {
		entry := raw.(map[string]any)
		recipients := entry["shared_users"].([]any)
		if len(recipients) != 1 || recipients[0].(map[string]any)["id"] != users[1] {
			t.Fatalf("分享列表重复或缺失: %v", entry)
		}
	}
	for _, raw := range afterB["models"].([]any) {
		entry := raw.(map[string]any)
		if entry["creator"].(map[string]any)["id"] != users[0] || entry["shared_users"] != nil || entry["base_url"] != nil || entry["api_key"] != nil {
			t.Fatalf("接收方元数据: %v", entry)
		}
	}
	assertAccess(users[1], ids[0], true)
	call("POST", "/resources/shares", "a", resource.ShareInput{Resources: share.Resources, UserIDs: []string{adminID}}, 204)
	assertAccess(adminID, ids[0], true)
	input["display_name"] = "更新后的模型"
	delete(input, "api_key")
	updated, _ := call("PUT", "/models/"+ids[0], "a", input, 200)
	if updated["api_key_configured"] != true || updated["credit_multiplier"] != float64(1) {
		t.Fatalf("编辑密钥或倍率错误: %v", updated)
	}
	target, err := repo.Resolve(ctx, users[1], ids[0])
	if err != nil || target.APIKey != "upstream-test-secret" || target.DisplayName != "更新后的模型" {
		t.Fatalf("编辑后调用配置错误: %v", err)
	}
	assertAccess(adminID, ids[0], true)
	call("DELETE", "/resources/shares", "b", resource.ShareInput{Resources: share.Resources, UserIDs: []string{adminID}}, 404)
	call("DELETE", "/resources/shares", "a", invalid, 404)
	assertAccess(users[1], ids[0], true)
	call("DELETE", "/resources/shares", "a", share, 204)
	call("DELETE", "/resources/shares", "a", share, 204)
	assertAccess(users[1], ids[0], false)
	assertAccess(adminID, ids[0], true)
	revoked, revokedHeaders := call("GET", "/models", "b", nil, 200)
	if len(revoked["models"].([]any)) != 0 || revokedHeaders.Get("ETag") == newHeadB.Get("ETag") {
		t.Fatal("撤销后配置仍包含模型或缓存未失效")
	}
	call("POST", "/resources/shares", "a", share, 204)
	call("DELETE", "/models/"+ids[0], "a", nil, 204)
	assertAccess(users[0], ids[0], false)
	assertAccess(users[1], ids[0], false)
	assertAccess(adminID, ids[0], false)
	call("PUT", "/models/"+ids[0], "a", input, 404)
	call("POST", "/resources/shares", "a", share, 404)
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM resource_access_grants WHERE resource_type='model' AND resource_id=$1`, ids[0]).Scan(&count); err != nil || count != 0 {
		t.Fatalf("删除后残留授权: %d %v", count, err)
	}
}
