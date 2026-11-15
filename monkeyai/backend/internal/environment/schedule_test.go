package environment

import (
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func schedulingFixture(t *testing.T) (*Service, string, string, string) {
	t.Helper()
	s, user, first := fixture(t)
	second := addConfiguredHost(t, s, user, first)
	for host, limit := range map[string]int{first: 2, second: 4} {
		if _, err := s.pool.Exec(t.Context(), "UPDATE hosts SET max_environments=$2 WHERE id=$1", host, limit); err != nil {
			t.Fatal(err)
		}
		if _, err := sqlc.New(s.pool).SetQuota(t.Context(), sqlc.SetQuotaParams{UserID: user, HostID: host, MaxEnvironments: 100}); err != nil {
			t.Fatal(err)
		}
	}
	return s, user, first, second
}
func TestSchedulingBalancesEnvironmentCountAcrossServices(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	counts := map[string]int{}
	for range 6 {
		e, err := NewService(s.pool).WithImages(s.images).Create(t.Context(), user, Creation{"count", resource.ID()})
		if err != nil {
			t.Fatal(err)
		}
		counts[e.Environment.HostID]++
	}
	if counts[first] != 2 || counts[second] != 4 {
		t.Fatal("数量容量分配不符", counts)
	}
	raw, err := os.ReadFile("../../migrations/000040_cloud_environments.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err = s.pool.Exec(t.Context(), string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.Create(t.Context(), user, Creation{"full", resource.ID()}); err == nil {
		t.Fatal("重放重置已分配数量")
	}
}
func TestConcurrentSchedulingCannotExceedEnvironmentCount(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	var wg sync.WaitGroup
	results := make(chan Result, 12)
	errs := make(chan error, 12)
	for range 12 {
		wg.Go(func() {
			e, err := NewService(s.pool).WithImages(s.images).Create(t.Context(), user, Creation{"concurrent", resource.ID()})
			results <- e
			errs <- err
		})
	}
	wg.Wait()
	close(results)
	close(errs)
	successes := 0
	for err := range errs {
		if err == nil {
			successes++
		} else {
			var f *failure
			if !errors.As(err, &f) || f.code != "capacity_unavailable" {
				t.Fatal(err)
			}
		}
	}
	counts := map[string]int{}
	for e := range results {
		if e.Environment.ID != "" {
			counts[e.Environment.HostID]++
		}
	}
	if successes != 6 || counts[first] != 2 || counts[second] != 4 {
		t.Fatal("并发超过数量上限", successes, counts)
	}
}
func TestSchedulingSkipsDisabledAndOfflineHosts(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	if _, err := s.pool.Exec(t.Context(), "UPDATE hosts SET max_environments=100"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE hosts SET enabled=false WHERE id=$1", second); err != nil {
		t.Fatal(err)
	}
	e, err := s.Create(t.Context(), user, Creation{"enabled", resource.ID()})
	if err != nil || e.Environment.HostID != first {
		t.Fatal(e, err)
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE hosts SET enabled=true,last_seen_at=now()-interval '2 minutes' WHERE id=$1", second); err != nil {
		t.Fatal(err)
	}
	e, err = s.Create(t.Context(), user, Creation{"offline", resource.ID()})
	if err != nil || e.Environment.HostID != first {
		t.Fatal(e, err)
	}
}
func TestCreationRetryDoesNotRescheduleAfterConfigRemoved(t *testing.T) {
	s, user, _, _ := schedulingFixture(t)
	in := Creation{"retry", "retry"}
	e, err := s.Create(t.Context(), user, in)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE host_environment_configs SET resource=NULL"); err != nil {
		t.Fatal(err)
	}
	retry, err := s.Create(t.Context(), user, in)
	if err != nil || retry.Environment.ID != e.Environment.ID || retry.Operation.ID != e.Operation.ID {
		t.Fatal("重试改变环境或操作", err)
	}
	if _, err = s.Create(t.Context(), user, Creation{"different", in.RequestKey}); err == nil {
		t.Fatal("创建幂等键参数冲突被接受")
	}
	if _, err = s.Create(t.Context(), user, Creation{"new", "new"}); err == nil {
		t.Fatal("未配置资源仍创建")
	}
}
