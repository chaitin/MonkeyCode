package agentconfig

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
)

func TestSharedExpertDependencies(t *testing.T) {
	for _, mode := range []string{"用户", "上级分组", "全员"} {
		t.Run(mode, func(t *testing.T) {
			r, recipient, owner := catalogDatabase(t)
			ctx := t.Context()
			expertID, skillID, connectorID := resource.ID(), resource.ID(), resource.ID()
			catalogExec(t, r, "INSERT INTO experts(id,ownership_type,owner_user_id,created_by_user_id,name,description,prompt) VALUES($1,'user',$2,$2,'共享专家','','prompt')", expertID, owner)
			catalogExec(t, r, "INSERT INTO skills(id,ownership_type,owner_user_id,name,description,package_file_name,package_s3_key,package_size_bytes,package_sha256) VALUES($1,'user',$2,'共享技能','','skill.zip','skill.zip',1,'sha256')", skillID, owner)
			catalogExec(t, r, "INSERT INTO connectors(id,ownership_type,owner_user_id,name,url,authorization_mode,authorization_method) VALUES($1,'user',$2,'共享连接','https://example.com/mcp','independent','http_header')", connectorID, owner)
			catalogExec(t, r, "INSERT INTO expert_skills(expert_id,skill_id) VALUES($1,$2)", expertID, skillID)
			catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id,required) VALUES($1,$2,false)", expertID, connectorID)
			credentialID := resource.ID()
			catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,name,http_headers,config_revision) VALUES($1,$2,$3,'所有者凭据','{\"X-Secret\":\"owner-secret\"}',1)", credentialID, connectorID, owner)

			input := resource.ShareInput{Resources: []resource.ShareResource{{Type: "expert", ID: expertID}}, UserIDs: []string{recipient}}
			group := ""
			switch mode {
			case "上级分组":
				parent := resource.ID()
				group = resource.ID()
				catalogExec(t, r, "INSERT INTO groups(id,name) VALUES($1,'parent')", parent)
				catalogExec(t, r, "INSERT INTO groups(id,name,parent_id) VALUES($1,'child',$2)", group, parent)
				catalogExec(t, r, "INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)", group, recipient, owner)
				input.UserIDs, input.GroupIDs = nil, []string{parent}
			case "全员":
				input.UserIDs, input.GroupIDs = nil, []string{rootgroup.ID}
			}
			kinds := map[string]resource.Shareable{"expert": expert.NewService(r.store).CRUD}
			handler := catalogHandler(t, r, recipient)
			etags := map[string]string{}
			assertAccess := func(want bool) {
				t.Helper()
				for kind, id := range map[string]string{"skill": skillID, "connector": connectorID} {
					allowed, err := resource.Allowed(ctx, r.store.Pool, kind, id, recipient)
					if err != nil || allowed != want {
						t.Fatalf("%s 使用权限=%v want=%v err=%v", kind, allowed, want, err)
					}
					path := "/" + kind + "s?owner=shared&page_size=1"
					w := catalogRead(t, handler, recipient, path, etags[kind])
					etags[kind] = w.Header().Get("ETag")
					if w.Code == 304 {
						t.Fatalf("%s 权限变更后仍命中旧缓存", kind)
					}
					if strings.Contains(w.Body.String(), id) != want {
						t.Fatalf("%s 目录未同步权限: %s", kind, w.Body.String())
					}
					if strings.Contains(w.Body.String(), credentialID) || strings.Contains(w.Body.String(), "owner-secret") {
						t.Fatal("共享连接泄露了所有者凭据")
					}
				}
				_, err := r.mcp.Connector(ctx, r.store.Pool, connectorID, recipient, false)
				if (err == nil) != want {
					t.Fatalf("MCP 入口授权与目录不一致: %v", err)
				}
			}
			assertAccess(false)
			if err := r.store.Share(ctx, owner, input, false, kinds); err != nil {
				t.Fatal(err)
			}
			assertAccess(true)
			manifest := catalogRead(t, handler, recipient, "/experts/"+expertID+"/manifest", "")
			var out resource.Object
			if err := json.Unmarshal(manifest.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if !out.Bool("available") || len(out["skills"].([]any)) != 1 || len(out["connectors"].([]any)) != 1 {
				t.Fatalf("专家未携带技能和连接: %s", manifest.Body.String())
			}
			connector := out["connectors"].([]any)[0].(map[string]any)
			if len(connector["credentials"].([]any)) != 0 {
				t.Fatal("接收者继承了所有者的独立凭据")
			}
			recipientCredential := resource.ID()
			catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,name,http_headers,config_revision) VALUES($1,$2,$3,'接收者凭据','{\"X-Secret\":\"recipient-secret\"}',1)", recipientCredential, connectorID, recipient)
			resolved, err := r.Resolve(ctx, recipient, resource.Object{"expert_id": expertID})
			if err != nil || !resolved.Bool("available") || len(resolved["skills"].([]resource.Object)) != 1 || len(resolved["connectors"].([]resource.Object)) != 1 {
				t.Fatalf("接收者使用自己的凭据解析专家失败: %v %v", resolved, err)
			}
			if resolved["connectors"].([]resource.Object)[0].String("credential_id") != recipientCredential {
				t.Fatal("专家解析未选择接收者自己的凭据")
			}
			if group != "" {
				catalogExec(t, r, "UPDATE group_users SET removed_at=now() WHERE group_id=$1 AND user_id=$2", group, recipient)
				assertAccess(false)
				catalogExec(t, r, "UPDATE group_users SET removed_at=NULL WHERE group_id=$1 AND user_id=$2", group, recipient)
				assertAccess(true)
			}

			catalogExec(t, r, "DELETE FROM expert_skills WHERE expert_id=$1", expertID)
			catalogExec(t, r, "DELETE FROM expert_connectors WHERE expert_id=$1", expertID)
			assertAccess(false)
			catalogExec(t, r, "INSERT INTO expert_skills(expert_id,skill_id) VALUES($1,$2)", expertID, skillID)
			catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id,required) VALUES($1,$2,false)", expertID, connectorID)
			assertAccess(true)
			catalogExec(t, r, "UPDATE experts SET enabled=false WHERE id=$1", expertID)
			assertAccess(false)
			catalogExec(t, r, "UPDATE experts SET enabled=true WHERE id=$1", expertID)
			assertAccess(true)

			otherExpert := resource.ID()
			catalogExec(t, r, "INSERT INTO experts(id,ownership_type,owner_user_id,created_by_user_id,name,description,prompt) VALUES($1,'user',$2,$2,'另一共享专家','','prompt')", otherExpert, owner)
			catalogExec(t, r, "INSERT INTO expert_skills(expert_id,skill_id) VALUES($1,$2)", otherExpert, skillID)
			catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id,required) VALUES($1,$2,false)", otherExpert, connectorID)
			otherInput := input
			otherInput.Resources = []resource.ShareResource{{Type: "expert", ID: otherExpert}}
			if err := r.store.Share(ctx, owner, otherInput, false, kinds); err != nil {
				t.Fatal(err)
			}
			if err := r.store.Share(ctx, owner, input, true, kinds); err != nil {
				t.Fatal(err)
			}
			// 另一专家仍授予相同权限，目录内容不变。
			for kind, id := range map[string]string{"skill": skillID, "connector": connectorID} {
				allowed, err := resource.Allowed(ctx, r.store.Pool, kind, id, recipient)
				if err != nil || !allowed {
					t.Fatalf("撤销一个专家误伤另一专家授权: %s %v", kind, err)
				}
			}
			if err := r.store.Share(ctx, owner, otherInput, true, kinds); err != nil {
				t.Fatal(err)
			}
			assertAccess(false)

			if err := r.store.Share(ctx, owner, input, false, kinds); err != nil {
				t.Fatal(err)
			}
			for kind, id := range map[string]string{"skill": skillID, "connector": connectorID} {
				catalogExec(t, r, "INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES($1,$2,$3,'read_only',$4)", kind, id, recipient, owner)
			}
			if err := r.store.Share(ctx, owner, input, true, kinds); err != nil {
				t.Fatal(err)
			}
			assertAccess(true)
		})
	}
}

func TestSharedExpertCannotReshareOtherOwnersDependencies(t *testing.T) {
	r, recipient, owner := catalogDatabase(t)
	foreignOwner := resource.ID()
	catalogExec(t, r, "INSERT INTO users(id,name,email) VALUES($1::uuid,$1::text,$1::text)", foreignOwner)
	expertID := resource.ID()
	catalogExec(t, r, "INSERT INTO experts(id,ownership_type,owner_user_id,created_by_user_id,name,description,prompt) VALUES($1,'user',$2,$2,'不能转分享的专家','','prompt')", expertID, owner)
	dependencyIDs := map[string]bool{}
	for _, ownership := range []string{"user", "system"} {
		for _, kind := range []string{"skill", "connector"} {
			id := resource.ID()
			dependencyIDs[id] = true
			if kind == "skill" {
				catalogExec(t, r, "INSERT INTO skills(id,ownership_type,owner_user_id,name,description,package_file_name,package_s3_key,package_size_bytes,package_sha256) VALUES($1,$2,$3,'不可转分享技能','','skill.zip','skill.zip',1,'sha256')", id, ownership, foreignOwner)
				catalogExec(t, r, "INSERT INTO expert_skills(expert_id,skill_id) VALUES($1,$2)", expertID, id)
			} else {
				catalogExec(t, r, "INSERT INTO connectors(id,ownership_type,owner_user_id,name,url,authorization_mode) VALUES($1,$2,$3,'不可转分享连接','https://example.com/mcp','none')", id, ownership, foreignOwner)
				catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id) VALUES($1,$2)", expertID, id)
			}
			catalogExec(t, r, "INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES($1,$2,$3,'read_only',$4)", kind, id, owner, foreignOwner)
		}
	}
	input := resource.ShareInput{Resources: []resource.ShareResource{{Type: "expert", ID: expertID}}, UserIDs: []string{recipient}}
	if err := r.store.Share(t.Context(), owner, input, false, map[string]resource.Shareable{"expert": expert.NewService(r.store).CRUD}); err != nil {
		t.Fatal(err)
	}
	c, err := r.load(t.Context(), r.store.Pool, recipient, "")
	if err != nil {
		t.Fatal(err)
	}
	for kind, objects := range map[string]map[string]resource.Object{"skill": c.skills, "connector": c.connectors} {
		for id, o := range objects {
			// Only these fixtures belong to other owners; built-in connectors are independent of expert sharing.
			if !dependencyIDs[id] {
				continue
			}
			allowed, err := resource.Allowed(t.Context(), r.store.Pool, kind, id, recipient)
			if err != nil || allowed || c.allowed(kind, o, recipient) {
				t.Fatalf("专家扩大了他人资源或系统资源权限: %s %v", kind, err)
			}
		}
	}
}
