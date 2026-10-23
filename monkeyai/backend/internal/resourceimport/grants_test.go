package resourceimport

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
)

func TestImportGrants(t *testing.T) {
	for _, subject := range []string{"root", "user", "group", "empty"} {
		t.Run(subject, func(t *testing.T) {
			f := newImportTest(t)
			apply := func(data []byte, action string) {
				t.Helper()
				preview := f.post(data, nil, http.StatusOK)
				if len(preview.Changes) != 4 {
					t.Fatalf("四类资源未完整预览: %+v", preview)
				}
				for _, change := range preview.Changes {
					if change.Action != action {
						t.Fatalf("%s: %s，预期 %s", change.Slug, change.Action, action)
					}
				}
				f.post(data, &preview, http.StatusOK)
			}
			apply(taggedFixture(t, 16, []string{"初始标签"}), "create")
			current, err := bindings(t.Context(), f.pool, "monkeyai-respub")
			if err != nil {
				t.Fatal(err)
			}
			member := resource.ID()
			f.exec(`INSERT INTO users(id,name,email) VALUES($1,'普通成员','member@example.com')`, member)
			group := resource.ID()
			f.exec(`INSERT INTO groups(id,name) VALUES($1,'指定分组')`, group)
			for _, item := range current {
				grants, err := resource.Grants(t.Context(), f.pool, item.Type, item.ID)
				if err != nil {
					t.Fatal(err)
				}
				if len(grants) != 1 || grants[0].String("group_id") != rootgroup.ID || grants[0].String("usage_requirement") != "optional" {
					t.Fatalf("%s 未默认授权到根分组: %+v", item.Type, grants)
				}
				allowed, err := resource.Allowed(t.Context(), f.pool, item.Type, item.ID, member)
				if err != nil || !allowed {
					t.Fatalf("普通成员无法使用默认授权资源 %s: %v", item.Type, err)
				}
				if subject == "root" {
					continue
				}
				grants = []resource.Object{}
				switch subject {
				case "user":
					grants = append(grants, resource.Object{"user_id": member})
				case "group":
					grants = append(grants, resource.Object{"group_id": group})
				}
				if item.Type == "rule" && len(grants) != 0 {
					grants[0]["usage_requirement"] = "required"
				}
				tx, err := f.pool.Begin(t.Context())
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback(t.Context())
				if err := resource.SaveGrants(t.Context(), tx, item.Type, item.ID, f.actor, grants, false); err != nil {
					t.Fatal(err)
				}
				if err := tx.Commit(t.Context()); err != nil {
					t.Fatal(err)
				}
			}
			snapshot := func() string {
				t.Helper()
				var data string
				if err := f.pool.QueryRow(t.Context(), `SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY id),'[]')::text FROM resource_access_grants g`).Scan(&data); err != nil {
					t.Fatal(err)
				}
				return data
			}
			original := snapshot()
			assertUnchanged := func() {
				t.Helper()
				if got := snapshot(); got != original {
					t.Fatalf("导入改变了已有授权: %s，预期 %s", got, original)
				}
			}
			apply(taggedFixture(t, 17, []string{"初始标签"}), "skip")
			assertUnchanged()
			updated := taggedFixture(t, 18, []string{"更新标签"})
			apply(updated, "update")
			assertUnchanged()
			preview := f.post(updated, nil, http.StatusOK)
			if !preview.AlreadyImported {
				t.Fatal("重复导入应返回已导入状态")
			}
			f.post(updated, &preview, http.StatusOK)
			assertUnchanged()
			retired := packageFixture(t, func(m *Manifest, _ map[string][]byte) {
				m.Version = 19
				m.AgentResources = AgentResources{}
			})
			apply(retired, "retire")
			assertUnchanged()
			apply(taggedFixture(t, 20, []string{"恢复标签"}), "restore")
			assertUnchanged()
		})
	}
}

func TestImportGrantFailureRollsBack(t *testing.T) {
	f := newImportTest(t)
	f.exec(`CREATE FUNCTION reject_expert_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type='expert' THEN RAISE EXCEPTION 'test grant failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER reject_expert_grant BEFORE INSERT ON resource_access_grants FOR EACH ROW EXECUTE FUNCTION reject_expert_grant()`)
	data := taggedFixture(t, 16, []string{"应回滚的标签"})
	preview := f.post(data, nil, http.StatusOK)
	f.post(data, &preview, http.StatusInternalServerError)
	var remaining []byte
	if err := f.pool.QueryRow(t.Context(), `SELECT jsonb_build_array(
		(SELECT count(*) FROM skills), (SELECT count(*) FROM rules),
		(SELECT count(*) FROM connectors), (SELECT count(*) FROM experts),
		(SELECT count(*) FROM resource_access_grants), (SELECT count(*) FROM resource_imports),
		(SELECT count(*) FROM resource_import_bindings), (SELECT count(*) FROM tags))`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	var counts []int
	if err := json.Unmarshal(remaining, &counts); err != nil {
		t.Fatal(err)
	}
	for _, count := range counts {
		if count != 0 {
			t.Fatalf("授权失败未回滚整个资源导入事务: %s", remaining)
		}
	}
}
