package environment

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

func TestAdminEnvironmentIdentities(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	created, err := s.Create(ctx, user, Creation{"展示验证", "identities"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE users SET avatar_url='provider.png',custom_avatar_url='custom.png' WHERE id=$1`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE hosts SET report=jsonb_set(report,'{system}','{"hostname":"worker-01","os_name":"Ubuntu 24.04"}') WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	s.list(true)(recorder, httptest.NewRequest("GET", "/environments", nil))
	if recorder.Code != 200 {
		t.Fatal(recorder.Code, recorder.Body.String())
	}
	var result struct {
		Items []View `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 1 {
		t.Fatal(result)
	}
	item := result.Items[0]
	if item.ID != created.Environment.ID || item.User == nil || item.User.Name != "环境测试" || item.User.Email != user+"@example.com" || item.User.AvatarURL != "custom.png" || item.Host == nil || item.Host.Hostname != "worker-01" || item.Host.OSName != "Ubuntu 24.04" {
		t.Fatalf("展示信息不完整: %+v", item)
	}
	row, err := sqlc.New(s.pool).GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: item.ID})
	if err != nil {
		t.Fatal(err)
	}
	client, err := s.environmentView(ctx, row)
	if err != nil {
		t.Fatal(err)
	}
	if client.User != nil || client.Host != nil {
		t.Fatal("客户端暴露了管理端展示信息")
	}
	if _, err := s.pool.Exec(ctx, `UPDATE users SET custom_avatar_url='' WHERE id=$1`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE hosts SET report='{}',deleted_at=now() WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	if err := s.identities(ctx, result.Items); err != nil {
		t.Fatal(err)
	}
	item = result.Items[0]
	if item.User.AvatarURL != "provider.png" || item.Host.Name != "test" || item.Host.Hostname != "" || item.Host.OSName != "" {
		t.Fatalf("历史记录或回退信息错误: %+v", item)
	}
}
