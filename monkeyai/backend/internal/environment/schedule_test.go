package environment

import (
	"os"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func schedulingFixture(t *testing.T) (*Service, string, string, string) {
	t.Helper()
	s, user, first := fixture(t)
	second := addConfiguredHost(t, s, user, first)
	return s, user, first, second
}
func TestSchedulingBalancesEnvironmentCountAcrossServices(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	counts := map[string]int{}
	for range 6 {
		e, err := NewService(s.pool).WithImages(s.images).Create(t.Context(), user, Creation{testSpecification(), "count", resource.ID()})
		if err != nil {
			t.Fatal(err)
		}
		counts[e.Environment.HostID]++
	}
	if counts[first] != 3 || counts[second] != 3 {
		t.Fatal("环境数量未均衡", counts)
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
	if _, err = s.Create(t.Context(), user, Creation{testSpecification(), "more", resource.ID()}); err != nil {
		t.Fatal("重放后仍应允许新建", err)
	}
}
func TestConcurrentSchedulingBalancesWithoutCountLimit(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	var wg sync.WaitGroup
	results := make(chan Result, 12)
	errs := make(chan error, 12)
	for range 12 {
		wg.Go(func() {
			e, err := NewService(s.pool).WithImages(s.images).Create(t.Context(), user, Creation{testSpecification(), "concurrent", resource.ID()})
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
			t.Fatal(err)
		}
	}
	counts := map[string]int{}
	for e := range results {
		if e.Environment.ID != "" {
			counts[e.Environment.HostID]++
		}
	}
	if successes != 12 || counts[first] != 6 || counts[second] != 6 {
		t.Fatal("并发创建未均衡分配", successes, counts)
	}
}
func TestSchedulingSkipsDisabledAndOfflineHosts(t *testing.T) {
	s, user, first, second := schedulingFixture(t)
	if _, err := s.pool.Exec(t.Context(), "UPDATE hosts SET enabled=false WHERE id=$1", second); err != nil {
		t.Fatal(err)
	}
	e, err := s.Create(t.Context(), user, Creation{testSpecification(), "enabled", resource.ID()})
	if err != nil || e.Environment.HostID != first {
		t.Fatal(e, err)
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE hosts SET enabled=true,last_seen_at=now()-interval '2 minutes' WHERE id=$1", second); err != nil {
		t.Fatal(err)
	}
	e, err = s.Create(t.Context(), user, Creation{testSpecification(), "offline", resource.ID()})
	if err != nil || e.Environment.HostID != first {
		t.Fatal(e, err)
	}
}
func TestCreationRetryDoesNotRescheduleAfterConfigRemoved(t *testing.T) {
	s, user, _, _ := schedulingFixture(t)
	in := Creation{testSpecification(), "retry", "retry"}
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
	if _, err = s.Create(t.Context(), user, Creation{testSpecification(), "different", in.RequestKey}); err == nil {
		t.Fatal("创建幂等键参数冲突被接受")
	}
	if _, err = s.Create(t.Context(), user, Creation{testSpecification(), "new", "new"}); err == nil {
		t.Fatal("未配置资源仍创建")
	}
}
