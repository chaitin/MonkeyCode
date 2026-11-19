package environment

import (
	"testing"
	"time"

	engine "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

func TestHostNameEditAndClear(t *testing.T) {
	s, _, host, _ := setupFixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	alias, clear := "  测试宿主  ", "  "
	for _, tc := range []struct {
		input *string
		want  string
	}{{&alias, "测试宿主"}, {nil, "测试宿主"}, {&clear, ""}} {
		out, err := s.saveSetup(ctx, host, Setup{Name: tc.input})
		if err != nil {
			t.Fatal(err)
		}
		if out.HostName != tc.want {
			t.Fatalf("配置返回的宿主名称不符：%+v", out)
		}
		expected := tc.want
		if expected == "" {
			expected = "node-01"
		}
		if _, err := engine.New(s.pool).RecordHeartbeat(ctx, engine.RecordHeartbeatParams{Candidate: "node-01", ID: host, At: time.Now().UTC().Add(time.Minute), Report: []byte(`{"system":{"hostname":"node-01"}}`)}); err != nil {
			t.Fatal(err)
		}
		rows, err := q.AccessibleHostCandidates(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 || rows[0].Name != expected {
			t.Fatalf("客户端宿主数据不符：%+v", rows)
		}
	}
}
