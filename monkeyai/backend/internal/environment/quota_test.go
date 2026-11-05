package environment

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestQuotaTracksComputeWithoutDiskReservations(t *testing.T) {
	s, user, host, _ := fixture(t)
	ctx := t.Context()
	check := func(want Budget) {
		t.Helper()
		out, err := s.Quota(ctx, user)
		if err != nil || out.Usage != want {
			t.Fatalf("额度占用不符：%+v，%v，预期 %+v", out, err, want)
		}
		if out.Remaining.CPUMillis != out.Limits.CPUMillis-want.CPUMillis || out.Remaining.StorageBytes != out.Limits.StorageBytes-want.StorageBytes {
			t.Fatal("剩余额度不符", out)
		}
	}
	check(Budget{})
	created, err := s.Create(ctx, user, Creation{"项目", "quota-create"})
	if err != nil {
		t.Fatal(err)
	}
	used := Budget{1, 1, 1000, 512 << 20, 0}
	check(used)
	stopped, err := s.Change(ctx, &user, created.Environment.ID, "stopped", Change{1, "quota-stop"})
	if err != nil {
		t.Fatal(err)
	}
	check(used)
	syncState(t, s, host, observe(stopped.Environment, "stopped"))
	check(Budget{Environments: 1})
	deleted, err := s.Change(ctx, &user, created.Environment.ID, "deleted", Change{2, "quota-delete"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(deleted.Environment, "deleted"))
	check(Budget{})
	other := resource.ID()
	if _, err := s.pool.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1::uuid,'环境测试',$1::text || '@example.com')", other); err != nil {
		t.Fatal(err)
	}
	out, err := s.Quota(ctx, other)
	if err != nil || out.Usage != (Budget{}) || out.Remaining != out.Limits {
		t.Fatal("其他用户额度受影响", out, err)
	}
	if _, err := sqlc.New(s.pool).SetQuota(ctx, sqlc.SetQuotaParams{UserID: other, MaxEnvironments: 1, MaxRunning: 1, CpuMillis: 2000, MemoryBytes: 2 << 30, StorageBytes: 5 << 30}); err != nil {
		t.Fatal(err)
	}
	out, err = s.Quota(ctx, other)
	if err != nil || out.Limits != (Budget{1, 1, 2000, 2 << 30, 0}) || out.Remaining != out.Limits {
		t.Fatal("未使用用户覆盖额度", out, err)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE users SET status='disabled' WHERE id=$1", other); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Quota(ctx, other); err == nil {
		t.Fatal("接受已停用用户")
	}
}

func TestLegacyDiskBudgetsDoNotBlockDirectoryStorage(t *testing.T) {
	s, user, host, _ := fixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	if _, err := q.SetHost(ctx, sqlc.SetHostParams{HostID: host, Enabled: true, CpuMillis: 8000, MemoryBytes: 16 << 30, MaxEnvironments: 10}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.SetQuota(ctx, sqlc.SetQuotaParams{UserID: user, MaxEnvironments: 3, MaxRunning: 2, CpuMillis: 8000, MemoryBytes: 16 << 30}); err != nil {
		t.Fatal(err)
	}
	created, err := s.Create(ctx, user, Creation{"普通目录", "directory-create"})
	if err != nil {
		t.Fatal(err)
	}
	var spec Spec
	if err := json.Unmarshal(created.Environment.Spec, &spec); err != nil {
		t.Fatal(err)
	}
	for _, v := range spec.Volumes {
		if v.Bytes != 0 || v.Inodes != 0 {
			t.Fatal("下发了已停用的磁盘限额")
		}
	}
	if _, err := s.pool.Exec(ctx, "UPDATE environments SET storage_bytes=$1 WHERE id=$2", int64(1<<40), created.Environment.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, user, Creation{"另一个目录", "directory-create-2"}); err != nil {
		t.Fatalf("历史磁盘占用不应阻断创建: %v", err)
	}
	out, err := s.Quota(ctx, user)
	if err != nil || out.Usage.StorageBytes != 0 || out.Remaining.StorageBytes != 0 || out.Limits.StorageBytes != 0 {
		t.Fatalf("磁盘字段未标为停用: %+v %v", out, err)
	}
}

func TestPresetWithoutDiskConfiguration(t *testing.T) {
	s, user, _, _ := fixture(t)
	p := profile()
	p.Storage = Storage{}
	raw, _ := json.Marshal(p)
	var configuration map[string]any
	if err := json.Unmarshal(raw, &configuration); err != nil {
		t.Fatal(err)
	}
	delete(configuration, "storage")
	body, _ := json.Marshal(map[string]any{"name": "普通目录预设", "configuration": configuration})
	w := httptest.NewRecorder()
	s.createPreset(w, httptest.NewRequest("POST", "/environment-presets", strings.NewReader(string(body))))
	if w.Code != 201 {
		t.Fatalf("未填写磁盘配置应可创建预设: %d %s", w.Code, w.Body)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE environment_defaults SET preset_id=$1", out.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(t.Context(), user, Creation{"普通目录", "no-disk-profile"}); err != nil {
		t.Fatal(err)
	}
}
