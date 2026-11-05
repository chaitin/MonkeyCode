package environment

import (
	"errors"
	"os"
	"reflect"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func schedulingFixture(t *testing.T) (*Service, string, string, string) {
	t.Helper()
	s, user, first, _ := fixture(t)
	second := resource.ID()
	ctx := t.Context()
	_, err := s.pool.Exec(ctx, `INSERT INTO engine_hosts(id,name,architecture,version,status,enrollment_hash,enrollment_expires_at,last_seen_at,report)
 VALUES($1::uuid,'second','amd64','v1','active',$1::text,now()+interval '1 hour',now(),'{"prerequisites_met":true}')`, second)
	if err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(s.pool)
	if err := q.TouchHost(ctx, second); err != nil {
		t.Fatal(err)
	}
	for host, cpu := range map[string]int64{first: 4000, second: 8000} {
		if _, err := s.pool.Exec(ctx, `UPDATE engine_hosts SET report=report || jsonb_build_object('system',jsonb_build_object('cpu',jsonb_build_object('logical_cores',$2::bigint),'memory',jsonb_build_object('total_bytes',17179869184))) WHERE id=$1`, host, cpu/1000); err != nil {
			t.Fatal(err)
		}
		if _, err := q.SetHost(ctx, sqlc.SetHostParams{HostID: host, Enabled: true, CpuMillis: cpu, MemoryBytes: 16 << 30, MaxEnvironments: 100}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := q.SetQuota(ctx, sqlc.SetQuotaParams{UserID: user, MaxEnvironments: 100, MaxRunning: 100, CpuMillis: 128000, MemoryBytes: 128 << 30}); err != nil {
		t.Fatal(err)
	}
	return s, user, first, second
}

func TestWeightedSchedulingAcrossServices(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	counts := map[string]int{}
	for i := range 6 {
		// 新 Service 模拟后台进程重启，状态必须来自数据库。
		created, err := NewService(s.pool).Create(t.Context(), user, Creation{Name: "项目", RequestKey: resource.ID()})
		if err != nil {
			t.Fatal(err)
		}
		counts[created.Environment.HostID]++
		if i%3 == 2 && counts[second] != 2*counts[first] {
			t.Fatalf("CPU 权重 1:2 未生效: %v", counts)
		}
	}
	q := sqlc.New(s.pool)
	before, err := q.SchedulingWeights(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../migrations/000042_environment_scheduling.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := s.pool.Exec(t.Context(), string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	after, err := q.SchedulingWeights(t.Context())
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("重复迁移改变了轮询状态", err)
	}
}

func TestConcurrentWeightedSchedulingAndCapacity(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	var wg sync.WaitGroup
	results := make(chan Result, 12)
	errors := make(chan error, 12)
	for range 12 {
		wg.Go(func() {
			result, err := NewService(s.pool).Create(t.Context(), user, Creation{Name: "并发", RequestKey: resource.ID()})
			results <- result
			errors <- err
		})
	}
	wg.Wait()
	close(results)
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	counts := map[string]int{}
	for result := range results {
		counts[result.Environment.HostID]++
	}
	if counts[first] != 4 || counts[second] != 8 {
		t.Fatalf("并发分配比例错误: %v", counts)
	}
	q := sqlc.New(s.pool)
	before, _ := q.SchedulingWeights(t.Context())
	if _, err := s.Create(t.Context(), user, Creation{Name: "超限", RequestKey: resource.ID()}); err == nil {
		t.Fatal("宿主资源超卖")
	}
	after, _ := q.SchedulingWeights(t.Context())
	if !reflect.DeepEqual(before, after) {
		t.Fatal("失败的创建改变了轮询状态")
	}
}

func TestSchedulingSkipsUnavailableHosts(t *testing.T) {
	for name, statement := range map[string]string{
		"disabled":        "UPDATE environment_hosts SET enabled=false WHERE host_id=$1",
		"offline":         "UPDATE engine_hosts SET last_seen_at=now()-interval '2 minutes' WHERE id=$1",
		"preflight":       `UPDATE engine_hosts SET report='{"prerequisites_met":false}' WHERE id=$1`,
		"architecture":    "UPDATE engine_hosts SET architecture='arm64' WHERE id=$1",
		"cpu":             `UPDATE engine_hosts SET report=jsonb_set(report,'{system,cpu,logical_cores}','0') WHERE id=$1`,
		"memory":          `UPDATE engine_hosts SET report=jsonb_set(report,'{system,memory,total_bytes}','1') WHERE id=$1`,
		"missing_metrics": `UPDATE engine_hosts SET report=report-'system' WHERE id=$1`,
	} {
		t.Run(name, func(t *testing.T) {
			s, user, first, second := schedulingFixture(t)
			if _, err := s.pool.Exec(t.Context(), statement, second); err != nil {
				t.Fatal(err)
			}
			created, err := s.Create(t.Context(), user, Creation{Name: "项目", RequestKey: "first"})
			if err != nil || created.Environment.HostID != first {
				t.Fatal("没有跳过不可用宿主", created, err)
			}
		})
	}
}

func TestSchedulingResetsChangedMembership(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	create := func() string {
		t.Helper()
		result, err := s.Create(t.Context(), user, Creation{Name: "项目", RequestKey: resource.ID()})
		if err != nil {
			t.Fatal(err)
		}
		return result.Environment.HostID
	}
	if create() != second {
		t.Fatal("首次没有优先高权重宿主")
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE environment_hosts SET enabled=false WHERE host_id=$1", second); err != nil {
		t.Fatal(err)
	}
	if create() != first {
		t.Fatal("未跳过离线宿主")
	}
	weights, err := sqlc.New(s.pool).SchedulingWeights(t.Context())
	if err != nil || len(weights) != 1 || weights[0].HostID != first {
		t.Fatal("保留了不可用宿主轮询状态", weights, err)
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE environment_hosts SET enabled=true WHERE host_id=$1", second); err != nil {
		t.Fatal(err)
	}
	if create() != second || create() != first || create() != second {
		t.Fatal("宿主恢复后未按 1:2 开启新轮次")
	}
}

func TestCreationUsesDefaultAndRetryDoesNotReschedule(t *testing.T) {
	s, user, _, _ := schedulingFixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	in := Creation{Name: "项目", RequestKey: "retry"}
	created, err := s.Create(ctx, user, in)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := q.SchedulingWeights(ctx)
	if _, err := s.pool.Exec(ctx, "UPDATE environment_defaults SET preset_id=NULL"); err != nil {
		t.Fatal(err)
	}
	retry, err := s.Create(ctx, user, in)
	if err != nil || retry.Environment.ID != created.Environment.ID || retry.Environment.HostID != created.Environment.HostID || retry.Environment.PresetID != created.Environment.PresetID {
		t.Fatal("重试受配置变更影响", retry, err)
	}
	after, _ := q.SchedulingWeights(ctx)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("重试推进了轮询")
	}
	_, err = s.Create(ctx, user, Creation{Name: "新环境", RequestKey: "new"})
	var failure *failure
	if !errors.As(err, &failure) || failure.code != "configuration_unavailable" {
		t.Fatal("缺少默认规格未返回明确错误", err)
	}
	old := struct {
		PresetID   string `json:"preset_id"`
		Name       string `json:"name"`
		RequestKey string `json:"request_key"`
	}{created.Environment.PresetID, in.Name, in.RequestKey}
	if _, err := s.pool.Exec(ctx, "UPDATE environments SET request_hash=$2 WHERE id=$1", created.Environment.ID, hash(old)); err != nil {
		t.Fatal(err)
	}
	if retry, err = s.Create(ctx, user, in); err != nil || retry.Environment.ID != created.Environment.ID {
		t.Fatal("不能重试旧格式创建记录", err)
	}
	if _, err := s.Create(ctx, user, Creation{Name: "其他项目", RequestKey: in.RequestKey}); err == nil {
		t.Fatal("接受旧幂等键的不同参数")
	}
}
