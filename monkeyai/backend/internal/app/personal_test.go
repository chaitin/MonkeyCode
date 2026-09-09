package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testPersonalResources(t *testing.T, pool *pgxpool.Pool, handler http.Handler, users []string) {
	request := func(method, path, token, match, contentType string, body []byte, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("If-Match", match)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d，预期 %d: %s", method, path, w.Code, want, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "personal-header-secret") {
			t.Fatal("响应泄露个人凭证")
		}
		return w
	}
	decode := func(w *httptest.ResponseRecorder) resource.Object {
		t.Helper()
		out := resource.Object{}
		if w.Body.Len() > 0 {
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		if out["package_s3_key"] != nil || out["oauth_client_secret"] != nil {
			t.Fatalf("响应泄露存储或凭证字段: %v", out)
		}
		assertNoIdentifiers(t, out)
		return out
	}
	call := func(method, path, token, match string, input any, want int) resource.Object {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return decode(request(method, path, token, match, "application/json", body, want))
	}
	etag := func(o resource.Object) string { return fmt.Sprintf(`"%d"`, o.Int("revision")) }
	contains := func(kind, token, id string) bool {
		t.Helper()
		out := call("GET", "/"+kind, token, "", nil, 200)
		for _, raw := range out[kind].([]any) {
			o := resource.Object(raw.(map[string]any))
			if o.String("id") == id {
				if o.String("ownership_type") != "user" || o.String("owner_user_id") != users[0] || o.Int("revision") < 1 {
					t.Fatalf("目录缺少个人资源管理信息: %v", o)
				}
				return true
			}
		}
		return false
	}
	ruleInput := resource.Object{"name": "个人规则测试", "content": "初始个人规则", "owner_user_id": users[1], "ownership_type": "system", "grants": []resource.Object{{"all_users": true, "usage_requirement": "required"}}}
	call("POST", "/rules", "", "", ruleInput, 401)
	rule := call("POST", "/rules", "a", "", ruleInput, 201)
	ruleID := rule.String("id")
	if rule.String("owner_user_id") != users[0] || rule.String("ownership_type") != "user" || len(rule["grants"].([]any)) != 0 {
		t.Fatalf("规则归属或授权被请求篡改: %v", rule)
	}
	call("POST", "/rules", "a", "", ruleInput, 409)
	otherRule := call("POST", "/rules", "b", "", ruleInput, 201)
	call("PUT", "/rules/"+ruleID, "a", "", ruleInput, 428)
	call("PUT", "/rules/"+ruleID, "a", `"0"`, ruleInput, 412)
	call("GET", "/rules/"+ruleID, "b", "", nil, 404)
	call("PUT", "/rules/"+ruleID, "b", etag(rule), ruleInput, 404)
	call("DELETE", "/rules/"+ruleID, "b", etag(rule), nil, 404)
	if !contains("rules", "a", ruleID) || contains("rules", "b", ruleID) {
		t.Fatal("个人规则可见范围错误")
	}

	archive := func(content string) []byte {
		t.Helper()
		var data bytes.Buffer
		writer := zip.NewWriter(&data)
		for name, body := range map[string]string{
			"personal/SKILL.md":            "---\nname: personal\ndescription: Personal skill\n---\n" + content,
			"personal/references/guide.md": "附属资源",
		} {
			file, err := writer.Create(name)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = file.Write([]byte(body)); err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return data.Bytes()
	}
	upload := func(method, path, token, match, content string, want int) resource.Object {
		t.Helper()
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		file, err := writer.CreateFormFile("package", "personal.zip")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.Write(archive(content)); err != nil {
			t.Fatal(err)
		}
		if err = writer.WriteField("metadata", `{"ownership_type":"system","enabled":false,"package_s3_key":"forged","grants":[{"all_users":true}]}`); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		return decode(request(method, path, token, match, writer.FormDataContentType(), body.Bytes(), want))
	}
	upload("POST", "/skills", "", "", "初始正文", 401)
	savedSkill := upload("POST", "/skills", "a", "", "初始正文", 201)
	skillID := savedSkill.String("id")
	if savedSkill.String("owner_user_id") != users[0] || savedSkill.String("ownership_type") != "user" || !savedSkill.Bool("enabled") || len(savedSkill["grants"].([]any)) != 0 {
		t.Fatalf("技能归属、启用状态或授权被篡改: %v", savedSkill)
	}
	call("GET", "/skills/"+skillID+"/manifest", "b", "", nil, 404)
	upload("PUT", "/skills/"+skillID+"/package", "b", etag(savedSkill), "越权正文", 404)
	call("DELETE", "/skills/"+skillID, "b", etag(savedSkill), nil, 404)

	share := resource.ShareInput{Resources: []resource.ShareResource{{Type: "rule", ID: ruleID}, {Type: "skill", ID: skillID}}, UserIDs: []string{users[1]}}
	invalid := resource.ShareInput{Resources: share.Resources, UserIDs: []string{users[1], resource.ID()}}
	call("POST", "/resources/shares", "a", "", invalid, 400)
	invalid = resource.ShareInput{Resources: append([]resource.ShareResource{{Type: "rule", ID: otherRule.String("id")}}, share.Resources...), UserIDs: share.UserIDs}
	call("POST", "/resources/shares", "a", "", invalid, 404)
	if contains("rules", "b", ruleID) || contains("skills", "b", skillID) {
		t.Fatal("失败的批量分享未回滚")
	}
	before := call("GET", "/skills", "a", "", nil, 200).String("version")
	call("POST", "/resources/shares", "a", "", share, 204)
	call("POST", "/resources/shares", "a", "", share, 204)
	if !contains("rules", "b", ruleID) || !contains("skills", "b", skillID) || before == call("GET", "/skills", "a", "", nil, 200).String("version") {
		t.Fatal("分享后目录或版本未更新")
	}
	call("POST", "/resources/shares", "b", "", resource.ShareInput{Resources: share.Resources, UserIDs: []string{users[0]}}, 404)
	call("PUT", "/skills/"+skillID, "b", etag(savedSkill), resource.Object{"name": "personal", "content": "越权"}, 404)
	call("PUT", "/rules/"+ruleID, "a", etag(rule), ruleInput, 412)
	rule = call("GET", "/rules/"+ruleID, "a", "", nil, 200)
	ruleInput["content"] = "分享后编辑"
	rule = call("PUT", "/rules/"+ruleID, "a", etag(rule), ruleInput, 200)
	if len(rule["grants"].([]any)) != 1 || rule["grants"].([]any)[0].(map[string]any)["usage_requirement"] != "optional" {
		t.Fatalf("编辑破坏分享或将个人规则设为强制: %v", rule)
	}
	savedSkill = call("GET", "/skills/"+skillID, "a", "", nil, 200)
	oldHash := savedSkill.String("package_sha256")
	savedSkill = call("PUT", "/skills/"+skillID, "a", etag(savedSkill), resource.Object{"name": "personal", "content": "编辑正文", "grants": []any{}}, 200)
	if savedSkill.String("package_sha256") == oldHash || len(savedSkill["grants"].([]any)) != 1 {
		t.Fatalf("技能编辑未更新摘要或破坏分享: %v", savedSkill)
	}
	download := request("GET", "/skills/"+skillID+"/package", "b", "", "", nil, 200)
	parsed, err := skill.Parse(download.Body.Bytes())
	if err != nil || parsed.Content != "编辑正文" || string(parsed.Files["references/guide.md"]) != "附属资源" || parsed.SHA != savedSkill.String("package_sha256") {
		t.Fatalf("分享技能下载未保留完整包: %v", err)
	}
	upload("PUT", "/skills/"+skillID+"/package", "a", `"1"`, "旧版本替换", 412)
	savedSkill = upload("PUT", "/skills/"+skillID+"/package", "a", etag(savedSkill), "替换正文", 200)
	manifest := call("GET", "/skills/"+skillID+"/manifest", "a", "", nil, 200)
	if manifest.String("content") != "替换正文" {
		t.Fatalf("技能包未替换: %v", manifest)
	}
	call("DELETE", "/resources/shares", "a", "", share, 204)
	if contains("rules", "b", ruleID) || contains("skills", "b", skillID) {
		t.Fatal("撤销分享后仍下发资源")
	}
	request("GET", "/skills/"+skillID+"/package", "b", "", "", nil, 404)
	call("POST", "/resources/shares", "a", "", share, 204)
	for _, item := range share.Resources {
		path := "/" + item.Type + "s/" + item.ID
		current := call("GET", path, "a", "", nil, 200)
		call("DELETE", path, "a", "", nil, 428)
		call("DELETE", path, "a", etag(current), nil, 204)
		call("GET", path, "a", "", nil, 404)
		var count int
		if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM resource_access_grants WHERE resource_type=$1 AND resource_id=$2`, item.Type, item.ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("删除未清理分享: count=%d err=%v", count, err)
		}
	}
	call("POST", "/resources/shares", "a", "", share, 404)

	provider := call("POST", "/connector-providers", "a", "", resource.Object{
		"name": "个人服务", "identifier": "github", "url": "https://example.com/mcp", "authorization_mode": "independent", "authorization_method": "http_header", "ownership_type": "system", "owner_user_id": users[1],
	}, 201)
	providerID := provider.String("id")
	if provider["identifier"] != nil || provider.String("owner_user_id") != users[0] || provider.String("ownership_type") != "user" {
		t.Fatalf("个人 Provider 归属或 identifier 错误: %v", provider)
	}
	call("GET", "/connector-providers/"+providerID, "b", "", nil, 404)
	call("POST", "/connectors", "b", "", resource.Object{"name": "他人服务", "provider_id": providerID}, 400)
	connector := call("POST", "/connectors", "a", "", resource.Object{
		"name": "个人连接", "provider_id": providerID, "url": "https://override.example.com/mcp", "authorization_mode": "centralized", "enabled": false, "grants": []resource.Object{{"all_users": true}},
	}, 201)
	connectorID := connector.String("id")
	if connector.String("url") != "https://example.com/mcp" || connector.String("authorization_mode") != "independent" || !connector.Bool("enabled") || len(connector["grants"].([]any)) != 0 {
		t.Fatalf("个人 Connector 覆盖了连接模板: %v", connector)
	}
	call("PUT", "/connectors/"+connectorID+"/credential", "a", "", resource.Object{"http_headers": resource.Object{"X-Test-Key": "personal-header-secret"}}, 204)
	connector = call("GET", "/connectors/"+connectorID, "a", "", nil, 200)
	if !connector.Bool("credential_configured") {
		t.Fatal("个人凭证状态未返回")
	}
	connector = call("PUT", "/connectors/"+connectorID, "a", etag(connector), resource.Object{"name": "编辑个人连接"}, 200)
	if !connector.Bool("credential_configured") || connector.String("provider_id") != providerID {
		t.Fatal("编辑连接丢失模板或凭证")
	}
	call("GET", "/connectors/"+connectorID, "b", "", nil, 404)
	call("PUT", "/connectors/"+connectorID+"/credential", "b", "", resource.Object{"http_headers": resource.Object{"X-Test-Key": "other"}}, 404)
	call("DELETE", "/connectors/"+connectorID, "b", etag(connector), nil, 404)
	if !contains("connectors", "a", connectorID) || contains("connectors", "b", connectorID) {
		t.Fatal("个人 Connector 可见范围错误")
	}
	call("POST", "/resources/shares", "a", "", resource.ShareInput{Resources: []resource.ShareResource{{Type: "connector", ID: connectorID}}, UserIDs: []string{users[1]}}, 400)
	call("DELETE", "/connector-providers/"+providerID, "a", etag(provider), nil, 409)
	call("DELETE", "/connectors/"+connectorID, "a", etag(connector), nil, 204)
	var activeCredentials int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM connector_credentials WHERE connector_id=$1 AND revoked_at IS NULL`, connectorID).Scan(&activeCredentials); err != nil || activeCredentials != 0 {
		t.Fatalf("删除 Connector 未撤销凭证: count=%d err=%v", activeCredentials, err)
	}
	call("DELETE", "/connector-providers/"+providerID, "a", etag(provider), nil, 204)
	call("GET", "/connector-providers/"+providerID, "a", "", nil, 404)
}
