package environment

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestCloudMigrationPreservesKnowledgeBaseAndGrant(t *testing.T) {
	s, user, _ := fixture(t)
	id := resource.ID()
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id) VALUES($1,'保留知识库',$2,$2)`, id, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$2)`, id, user); err != nil {
		t.Fatal(err)
	}
	snapshot := func() string {
		t.Helper()
		var value string
		if err := s.pool.QueryRow(t.Context(), `SELECT jsonb_build_array(
(SELECT to_jsonb(k) FROM knowledge_bases k WHERE id=$1),
(SELECT to_jsonb(g) FROM resource_access_grants g WHERE resource_type='kb' AND resource_id=$1 AND user_id=$2))::text`, id, user).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := snapshot()
	for _, direction := range []string{"up", "down", "down", "up", "up"} {
		if err := cloudMigration(t, s, direction); err != nil {
			t.Fatalf("云环境%s影响知识库：%v", direction, err)
		}
		if after := snapshot(); after != before {
			t.Fatalf("云环境%s修改了知识库或授权", direction)
		}
	}
}
