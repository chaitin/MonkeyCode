package app

import (
	"archive/zip"
	"bytes"
	"context"
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
				if o.String("ownership_type") != "user" || o["user"].(map[string]any)["id"] != users[0] || o.Int("revision") < 1 {
					t.Fatalf("目录缺少个人资源管理信息: %v", o)
				}
				if (token != "a" || kind == "rules") && o["shared_users"] != nil {
					t.Fatalf("目录不应返回共享用户: %v", o)
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
	if rule["user"].(map[string]any)["id"] != users[0] || rule.String("ownership_type") != "user" || len(rule["grants"].([]any)) != 0 || rule["shared_users"] != nil {
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

	ruleShare := resource.ShareInput{Resources: []resource.ShareResource{{Type: "rule", ID: ruleID}}, UserIDs: []string{users[1]}}
	call("POST", "/resources/shares", "a", "", ruleShare, 400)
	call("DELETE", "/resources/shares", "a", "", ruleShare, 400)
	beforeRules := call("GET", "/rules", "a", "", nil, 200).String("version")
	if _, err := pool.Exec(t.Context(), `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,usage_requirement,granted_by_user_id) VALUES('rule',$1,$2,'read_only','required',$2),('rule',$1,$3,'read_only','optional',$2)`, ruleID, users[0], users[1]); err != nil {
		t.Fatal(err)
	}
	if contains("rules", "b", ruleID) || beforeRules != call("GET", "/rules", "a", "", nil, 200).String("version") {
		t.Fatal("历史规则授权仍影响可见范围或所有者目录")
	}
	detail := call("GET", "/rules/"+ruleID, "a", "", nil, 200)
	if detail["shared_users"] != nil || len(detail["grants"].([]any)) != 0 {
		t.Fatalf("个人规则仍返回历史分享信息: %v", detail)
	}
	call("GET", "/rules/"+ruleID, "b", "", nil, 404)
	call("POST", "/resources/resolve", "b", "", resource.Object{"rule_ids": []string{ruleID}}, 404)
	call("POST", "/experts", "b", "", resource.Object{"name": "引用历史分享规则", "prompt": "测试", "rule_ids": []string{ruleID}}, 400)
	selected := call("POST", "/resources/resolve", "a", "", resource.Object{"rule_ids": []string{ruleID}}, 200)
	found := false
	for _, raw := range selected["rules"].([]any) {
		entry := resource.Object(raw.(map[string]any))
		if entry.String("id") == ruleID {
			found = true
			if entry.Bool("required") {
				t.Fatal("历史授权将个人规则设为强制")
			}
		}
	}
	if !found {
		t.Fatal("所有者不能使用个人规则")
	}
	for _, raw := range call("POST", "/resources/resolve", "a", "", resource.Object{}, 200)["rules"].([]any) {
		if raw.(map[string]any)["id"] == ruleID {
			t.Fatal("个人规则被自动强制应用")
		}
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
	if savedSkill["user"].(map[string]any)["id"] != users[0] || savedSkill.String("ownership_type") != "user" || !savedSkill.Bool("enabled") || len(savedSkill["grants"].([]any)) != 0 {
		t.Fatalf("技能归属、启用状态或授权被篡改: %v", savedSkill)
	}
	call("GET", "/skills/"+skillID+"/manifest", "b", "", nil, 404)
	upload("PUT", "/skills/"+skillID+"/package", "b", etag(savedSkill), "越权正文", 404)
	call("DELETE", "/skills/"+skillID, "b", etag(savedSkill), nil, 404)

	expertInput := resource.Object{"name": "个人专家测试", "prompt": "个人提示词", "rule_ids": []string{ruleID}, "skill_ids": []string{skillID}, "ownership_type": "system", "owner_user_id": users[1], "enabled": false, "grants": []resource.Object{{"all_users": true}}}
	call("POST", "/experts", "", "", expertInput, 401)
	call("POST", "/experts", "b", "", expertInput, 400)
	expert := call("POST", "/experts", "a", "", expertInput, 201)
	expertID := expert.String("id")
	expertPath := "/experts/" + expertID
	if expert["user"].(map[string]any)["id"] != users[0] || expert.String("ownership_type") != "user" || !expert.Bool("enabled") || len(expert["grants"].([]any)) != 0 {
		t.Fatalf("专家归属、启用状态或授权被篡改: %v", expert)
	}
	call("POST", "/experts", "a", "", expertInput, 409)
	otherExpert := call("POST", "/experts", "b", "", resource.Object{"name": expertInput["name"], "prompt": "其他用户"}, 201)
	call("DELETE", "/experts/"+otherExpert.String("id"), "b", etag(otherExpert), nil, 204)
	call("GET", expertPath, "b", "", nil, 404)
	call("GET", expertPath+"/manifest", "b", "", nil, 404)
	call("POST", "/resources/resolve", "b", "", resource.Object{"expert_id": expertID}, 404)
	call("PUT", expertPath, "a", "", expertInput, 428)
	call("PUT", expertPath, "a", `"0"`, expertInput, 412)
	expertShare := resource.ShareInput{Resources: []resource.ShareResource{{Type: "expert", ID: expertID}}, UserIDs: []string{users[1]}}
	call("POST", "/resources/shares", "a", "", expertShare, 204)
	blocked := call("GET", expertPath+"/manifest", "b", "", nil, 200)
	if blocked.Bool("available") || len(blocked["rules"].([]any)) != 0 || len(blocked["skills"].([]any)) != 0 {
		t.Fatalf("个人专家扩大了依赖资源权限: %v", blocked)
	}
	request("GET", expertPath+"/skills/"+skillID+"/package", "b", "", "", nil, 404)
	call("DELETE", "/resources/shares", "a", "", expertShare, 204)
	share := resource.ShareInput{Resources: []resource.ShareResource{{Type: "expert", ID: expertID}, {Type: "skill", ID: skillID}}, UserIDs: []string{users[1]}}
	invalid := resource.ShareInput{Resources: share.Resources, UserIDs: []string{users[1], resource.ID()}}
	call("POST", "/resources/shares", "a", "", invalid, 400)
	invalid = resource.ShareInput{Resources: append(share.Resources, ruleShare.Resources...), UserIDs: share.UserIDs}
	call("POST", "/resources/shares", "a", "", invalid, 400)
	invalid = resource.ShareInput{Resources: append([]resource.ShareResource{{Type: "skill", ID: resource.ID()}}, share.Resources...), UserIDs: share.UserIDs}
	call("POST", "/resources/shares", "a", "", invalid, 404)
	if contains("rules", "b", ruleID) || contains("skills", "b", skillID) || contains("experts", "b", expertID) {
		t.Fatal("失败的批量分享未回滚")
	}
	before := call("GET", "/skills", "a", "", nil, 200).String("version")
	call("POST", "/resources/shares", "a", "", share, 204)
	call("POST", "/resources/shares", "a", "", share, 204)
	if contains("rules", "b", ruleID) || !contains("skills", "b", skillID) || !contains("experts", "b", expertID) || before == call("GET", "/skills", "a", "", nil, 200).String("version") {
		t.Fatal("分享后目录或版本未更新")
	}

	blocked = call("GET", expertPath+"/manifest", "b", "", nil, 200)
	if blocked.Bool("available") || len(blocked["rules"].([]any)) != 0 || len(blocked["skills"].([]any)) != 1 {
		t.Fatalf("共享专家泄露了个人规则或丢失已授权技能: %v", blocked)
	}
	if owner := call("GET", expertPath+"/manifest", "a", "", nil, 200); !owner.Bool("available") || len(owner["rules"].([]any)) != 1 {
		t.Fatalf("所有者专家不可用: %v", owner)
	}
	expert = call("GET", expertPath, "a", "", nil, 200)
	expert = call("PUT", expertPath, "a", etag(expert), resource.Object{"name": expert["name"], "rule_ids": []string{}}, 200)

	t.Run("个人资源共享用户信息与缓存", func(t *testing.T) {
		assertUsers := func(name, email string, count int) {
			t.Helper()
			for _, item := range share.Resources {
				kind := item.Type + "s"
				detail := call("GET", "/"+kind+"/"+item.ID, "a", "", nil, 200)
				out := call("GET", "/"+kind, "a", "", nil, 200)
				found := false
				for _, raw := range out[kind].([]any) {
					entry := resource.Object(raw.(map[string]any))
					if entry.String("id") == item.ID {
						found = true
						for _, o := range []resource.Object{detail, entry} {
							people, ok := o["shared_users"].([]any)
							if !ok || len(people) != count {
								t.Fatalf("共享用户列表错误: %v", o)
							}
							if count > 0 {
								assertShareUser(t, people[0], users[1], name, email)
							}
						}
					}
				}
				if !found {
					t.Fatalf("所有者目录缺少资源: %v", out)
				}
				grants := detail["grants"].([]any)
				person := grants[0].(map[string]any)["user"]
				if count > 0 {
					assertShareUser(t, person, users[1], name, email)
				} else if person != nil {
					t.Fatalf("已删除用户仍返回展示信息: %v", person)
				}
			}
		}
		assertUsers("b", "b@example.com", 1)
		versions := map[string]string{}
		for _, kind := range []string{"skills", "experts"} {
			versions[kind] = call("GET", "/"+kind, "a", "", nil, 200).String("version")
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `UPDATE users SET name='b',email='b@example.com',status='active',deleted_at=NULL WHERE id=$1`, users[1])
		})
		if _, err := pool.Exec(t.Context(), `UPDATE users SET name='共享接收者',email='recipient@example.com',status='disabled' WHERE id=$1`, users[1]); err != nil {
			t.Fatal(err)
		}
		assertUsers("共享接收者", "recipient@example.com", 1)
		for kind, version := range versions {
			req := httptest.NewRequest("GET", "/api/v1/"+kind, nil)
			req.Header.Set("Authorization", "Bearer a")
			req.Header.Set("If-None-Match", `"`+version+`"`)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != 200 || decode(w).String("version") == version {
				t.Fatalf("用户信息变化未刷新 %s 缓存: %d %s", kind, w.Code, w.Body.String())
			}
		}
		if _, err := pool.Exec(t.Context(), `UPDATE users SET deleted_at=now() WHERE id=$1`, users[1]); err != nil {
			t.Fatal(err)
		}
		assertUsers("", "", 0)
	})
	call("POST", "/resources/shares", "b", "", resource.ShareInput{Resources: share.Resources, UserIDs: []string{users[0]}}, 404)
	call("PUT", expertPath, "b", etag(expert), expertInput, 404)
	call("DELETE", expertPath, "b", etag(expert), nil, 404)
	expert = call("GET", expertPath, "a", "", nil, 200)
	expert = call("PUT", expertPath, "a", etag(expert), resource.Object{"name": "编辑个人专家", "grants": []any{}}, 200)
	if expert.String("prompt") != "个人提示词" || len(expert["shared_users"].([]any)) != 1 || len(expert["rule_ids"].([]any)) != 0 {
		t.Fatalf("个人专家编辑丢失字段、依赖或共享: %v", expert)
	}
	resolved := call("POST", "/resources/resolve", "b", "", resource.Object{"expert_id": expertID}, 200)
	if !resolved.Bool("available") || len(resolved["skills"].([]any)) != 1 {
		t.Fatalf("共享专家不可用: %v", resolved)
	}
	request("GET", expertPath+"/skills/"+skillID+"/package", "b", "", "", nil, 200)
	skillShare := resource.ShareInput{Resources: []resource.ShareResource{{Type: "skill", ID: skillID}}, UserIDs: share.UserIDs}
	call("DELETE", "/resources/shares", "a", "", skillShare, 204)
	if call("GET", expertPath+"/manifest", "b", "", nil, 200).Bool("available") {
		t.Fatal("依赖撤权后专家仍可用")
	}
	request("GET", expertPath+"/skills/"+skillID+"/package", "b", "", "", nil, 404)
	call("POST", "/resources/shares", "a", "", skillShare, 204)
	call("PUT", "/skills/"+skillID, "b", etag(savedSkill), resource.Object{"name": "personal", "content": "越权"}, 404)
	oldRule := rule
	ruleInput["content"] = "编辑个人规则"
	rule = call("PUT", "/rules/"+ruleID, "a", etag(rule), ruleInput, 200)
	if rule.String("content") != "编辑个人规则" || len(rule["grants"].([]any)) != 0 || rule["shared_users"] != nil {
		t.Fatalf("个人规则编辑失败或仍返回分享信息: %v", rule)
	}
	call("PUT", "/rules/"+ruleID, "a", etag(oldRule), ruleInput, 412)
	if beforeRules == call("GET", "/rules", "a", "", nil, 200).String("version") {
		t.Fatal("个人规则编辑未刷新目录版本")
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
	if contains("rules", "b", ruleID) || contains("skills", "b", skillID) || contains("experts", "b", expertID) {
		t.Fatal("撤销分享后仍下发资源")
	}
	for _, item := range share.Resources {
		kind := item.Type + "s"
		detail := call("GET", "/"+kind+"/"+item.ID, "a", "", nil, 200)
		if people, ok := detail["shared_users"].([]any); !ok || len(people) != 0 {
			t.Fatalf("撤销后详情仍返回共享用户: %v", detail)
		}
		out := call("GET", "/"+kind, "a", "", nil, 200)
		for _, raw := range out[kind].([]any) {
			entry := raw.(map[string]any)
			if entry["id"] == item.ID {
				if people, ok := entry["shared_users"].([]any); !ok || len(people) != 0 {
					t.Fatalf("撤销后目录仍返回共享用户: %v", entry)
				}
			}
		}
	}
	call("GET", expertPath+"/manifest", "b", "", nil, 404)
	call("POST", "/resources/resolve", "b", "", resource.Object{"expert_id": expertID}, 404)
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

	call("DELETE", "/rules/"+ruleID, "a", "", nil, 428)
	call("DELETE", "/rules/"+ruleID, "a", etag(oldRule), nil, 412)
	call("DELETE", "/rules/"+ruleID, "a", etag(rule), nil, 204)
	call("GET", "/rules/"+ruleID, "a", "", nil, 404)
	if contains("rules", "a", ruleID) {
		t.Fatal("已删除的个人规则仍出现在目录")
	}
	var ruleGrants int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM resource_access_grants WHERE resource_type='rule' AND resource_id=$1`, ruleID).Scan(&ruleGrants); err != nil || ruleGrants != 0 {
		t.Fatalf("删除规则未清理历史授权: %d %v", ruleGrants, err)
	}
	call("DELETE", "/rules/"+otherRule.String("id"), "b", etag(otherRule), nil, 204)

	connector := call("POST", "/connectors", "a", "", resource.Object{
		"name": "个人连接", "url": "https://example.com/mcp", "authorization_mode": "independent", "authorization_method": "http_header", "enabled": false, "grants": []resource.Object{{"all_users": true}},
	}, 201)
	connectorID := connector.String("id")
	if connector.String("url") != "https://example.com/mcp" || connector.String("authorization_mode") != "independent" || !connector.Bool("enabled") || len(connector["grants"].([]any)) != 0 {
		t.Fatalf("个人 Connector 覆盖了连接模板: %v", connector)
	}
	call("POST", "/connectors/"+connectorID+"/credentials", "a", "", resource.Object{"name": "测试凭证", "http_headers": resource.Object{"X-Test-Key": "personal-header-secret"}}, 201)
	connector = call("GET", "/connectors/"+connectorID, "a", "", nil, 200)
	if !connector.Bool("credential_configured") {
		t.Fatal("个人凭证状态未返回")
	}
	connector = call("PUT", "/connectors/"+connectorID, "a", etag(connector), resource.Object{"name": "编辑个人连接"}, 200)
	if !connector.Bool("credential_configured") {
		t.Fatal("编辑连接丢失模板或凭证")
	}
	call("GET", "/connectors/"+connectorID, "b", "", nil, 404)
	call("POST", "/connectors/"+connectorID+"/credentials", "b", "", resource.Object{"name": "测试凭证", "http_headers": resource.Object{"X-Test-Key": "other"}}, 404)
	call("DELETE", "/connectors/"+connectorID, "b", etag(connector), nil, 404)
	if !contains("connectors", "a", connectorID) || contains("connectors", "b", connectorID) {
		t.Fatal("个人 Connector 可见范围错误")
	}
	connectorShare := resource.ShareInput{Resources: []resource.ShareResource{{Type: "connector", ID: connectorID}}, UserIDs: []string{users[1]}}
	connectorVersion := call("GET", "/connectors", "a", "", nil, 200).String("version")
	call("POST", "/resources/shares", "a", "", connectorShare, 204)
	call("POST", "/resources/shares", "a", "", connectorShare, 204)
	if !contains("connectors", "b", connectorID) || connectorVersion == call("GET", "/connectors", "a", "", nil, 200).String("version") {
		t.Fatal("共享工具目录或版本未更新")
	}
	call("GET", "/connectors/"+connectorID, "b", "", nil, 404)
	call("PUT", "/connectors/"+connectorID, "b", etag(connector), resource.Object{"name": "越权编辑"}, 404)
	call("DELETE", "/connectors/"+connectorID, "b", etag(connector), nil, 404)
	call("POST", "/resources/shares", "b", "", resource.ShareInput{Resources: connectorShare.Resources, UserIDs: []string{users[0]}}, 404)
	call("POST", "/connectors/"+connectorID+"/credentials", "b", "", resource.Object{"name": "测试凭证", "http_headers": resource.Object{"X-Test-Key": "recipient-secret"}}, 201)
	boundExpert := call("POST", "/experts", "b", "", resource.Object{"name": "使用共享连接的专家", "prompt": "测试", "connectors": []resource.Object{{"connector_id": connectorID}}}, 201)
	boundPath := "/experts/" + boundExpert.String("id")
	if out := call("GET", boundPath+"/manifest", "b", "", nil, 200); !out.Bool("available") {
		t.Fatalf("共享连接不能用于专家: %v", out)
	}
	call("DELETE", "/resources/shares", "a", "", connectorShare, 204)
	if contains("connectors", "b", connectorID) {
		t.Fatal("撤销后仍下发共享工具")
	}
	call("GET", "/connectors/"+connectorID+"/tools", "b", "", nil, 404)
	call("POST", "/connectors/"+connectorID+"/credentials", "b", "", resource.Object{"name": "测试凭证", "http_headers": resource.Object{}}, 404)
	if out := call("GET", boundPath+"/manifest", "b", "", nil, 200); out.Bool("available") {
		t.Fatalf("共享连接撤权后专家仍可用: %v", out)
	}
	call("DELETE", boundPath, "b", etag(boundExpert), nil, 204)
	call("POST", "/resources/shares", "a", "", connectorShare, 204)
	connector = call("GET", "/connectors/"+connectorID, "a", "", nil, 200)
	if len(connector["shared_users"].([]any)) != 1 {
		t.Fatal("工具共享名单重复或缺失")
	}

	call("DELETE", "/connectors/"+connectorID, "a", etag(connector), nil, 204)
	call("GET", "/connectors/"+connectorID+"/tools", "b", "", nil, 404)
	var grants int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM resource_access_grants WHERE resource_type='connector' AND resource_id=$1`, connectorID).Scan(&grants); err != nil || grants != 0 {
		t.Fatalf("删除未清理工具分享: %d %v", grants, err)
	}
	var activeCredentials int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM connector_credentials WHERE connector_id=$1 AND revoked_at IS NULL`, connectorID).Scan(&activeCredentials); err != nil || activeCredentials != 0 {
		t.Fatalf("删除 Connector 未撤销凭证: count=%d err=%v", activeCredentials, err)
	}
}
