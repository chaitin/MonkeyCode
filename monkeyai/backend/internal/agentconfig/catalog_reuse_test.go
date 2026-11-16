package agentconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

type catalogQueries struct {
	resource.Queryer
	counts map[string]int
}

func (q *catalogQueries) record(sql string) {
	fields := strings.Fields(sql)
	if len(fields) > 2 && fields[0] == "--" {
		q.counts[fields[2]]++
	}
}

func (q *catalogQueries) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	q.record(sql)
	return q.Queryer.Query(ctx, sql, args...)
}

func (q *catalogQueries) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	q.record(sql)
	return q.Queryer.QueryRow(ctx, sql, args...)
}

func TestCatalogBatchTags(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	q := &catalogQueries{Queryer: r.store.Pool, counts: map[string]int{}}
	items, err := r.list(t.Context(), q, user, "skills", resource.CatalogFilter{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if q.counts["CatalogTags"] != 1 || q.counts["ResourceTags"] != 0 {
		t.Fatalf("标签查询随资源数量增长: %v", q.counts)
	}
	for _, item := range items {
		if tags, ok := item["tags"].([]resource.Object); !ok || tags == nil {
			t.Fatalf("无标签资源应返回空数组: %v", item)
		}
	}
}

func TestCatalogReusesConnectorAcrossExperts(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	ids := []string{"10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000002"}
	connector := ids[0]
	for i, id := range ids {
		catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id,tool_allowlist) VALUES($1,$2,$3)", id, connector, []string{fmt.Sprintf("tool%d", i)})
		catalogExec(t, r, "INSERT INTO mcp_tools(connector_id,name,enabled,config_revision) VALUES($1,$2,true,1)", connector, fmt.Sprintf("tool%d", i))
	}
	q := &catalogQueries{Queryer: r.store.Pool, counts: map[string]int{}}
	c, err := r.loadSelected(t.Context(), q, user, "experts", ids)
	if err != nil {
		t.Fatal(err)
	}
	for i, id := range ids {
		manifest, err := r.manifest(t.Context(), q, c, id, user)
		if err != nil {
			t.Fatal(err)
		}
		conn := manifest["connectors"].([]resource.Object)[0]
		if _, ok := conn["tools"]; ok {
			t.Fatalf("专家配置不应内嵌工具: %v", conn)
		}
		if got := resource.Strings(conn["tool_allowlist"]); len(got) != 1 || got[0] != fmt.Sprintf("tool%d", i) {
			t.Fatalf("专家工具允许规则丢失: %v", conn)
		}
	}
	if q.counts["ListTools"] != 0 || q.counts["ListCatalogTools"] != 0 {
		t.Fatalf("专家配置不应查询工具目录: %v", q.counts)
	}
}

func TestCloneConnectorCredentials(t *testing.T) {
	base := resource.Object{"credentials": []resource.Object{{"id": "credential", "name": "原始凭证"}}}
	cloned := cloneConnector(base)
	cloned["credentials"].([]resource.Object)[0]["name"] = "修改凭证"
	if base["credentials"].([]resource.Object)[0].String("name") != "原始凭证" {
		t.Fatal("凭证修改污染了共享连接器")
	}
}

func TestCatalogIndependentToolsBatched(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	connector := "10000000-0000-0000-0000-000000000001"
	catalogExec(t, r, "UPDATE connectors SET authorization_mode='independent',authorization_method='http_header' WHERE id=$1", connector)
	for i := range 4 {
		id, owner := resource.ID(), user
		if i == 3 {
			owner = other
		}
		headers := fmt.Sprintf("{\"X-Test\":\"secret-%d\"}", i)
		if i == 2 {
			headers = "{}"
		}
		catalogExec(t, r, "INSERT INTO connector_credentials(id,connector_id,user_id,http_headers,config_revision,name) VALUES($1,$2,$3,$4::jsonb,1,$5)", id, connector, owner, headers, fmt.Sprintf("credential%d", i))
		for j, name := range []string{"visible", "disabled", "stale"} {
			revision := 1
			if j == 2 {
				revision = 2
			}
			catalogExec(t, r, "INSERT INTO mcp_tools(connector_id,credential_id,name,enabled,config_revision) VALUES($1,$2,$3,$4,$5)", connector, id, name, j != 1, revision)
		}
	}
	q := &catalogQueries{Queryer: r.store.Pool, counts: map[string]int{}}
	c, err := r.loadSelected(t.Context(), q, user, "connectors", []string{connector})
	if err != nil {
		t.Fatal(err)
	}
	out, err := r.connectorDTO(t.Context(), q, c, c.connectors[connector], user)
	if err != nil {
		t.Fatal(err)
	}
	credentials := out["credentials"].([]resource.Object)
	if len(credentials) != 3 {
		t.Fatalf("凭证越过用户边界: %v", credentials)
	}
	for _, credential := range credentials {
		if _, ok := credential["tools"]; ok {
			t.Fatalf("凭证目录不应内嵌工具: %v", credential)
		}
		if _, ok := credential["tools_version"]; ok {
			t.Fatalf("凭证目录不应包含工具版本: %v", credential)
		}
	}
	if q.counts["ListCatalogTools"] != 0 || q.counts["ListTools"] != 0 || q.counts["GetCredential"] != 0 {
		t.Fatalf("连接器目录不应读取工具配置: %v", q.counts)
	}
	encoded, _ := json.Marshal(out)
	if strings.Contains(string(encoded), "secret-") || strings.Contains(string(encoded), "http_headers") {
		t.Fatal("公开目录泄漏了凭证内容")
	}
}
