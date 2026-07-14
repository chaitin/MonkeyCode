package vmrecycle

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestAnalyzerCandidateRequiresBothDeadlinesOverdue(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	taskID := uuid.New()
	logStore := consts.LogStoreClickHouse
	activityAt := now.Add(-90 * time.Minute)
	vm := &db.VirtualMachine{
		ID:     "vm-candidate",
		UserID: uuid.New(),
		Edges: db.VirtualMachineEdges{Tasks: []*db.Task{{
			ID:           taskID,
			Status:       consts.TaskStatusProcessing,
			CreatedAt:    now.Add(-2 * time.Hour),
			LastActiveAt: activityAt,
			LogStore:     &logStore,
		}}},
	}
	redisAt := now.Add(-time.Minute)
	analyzer := newAnalyzerForTest(now, &analyzerDeadlineStub{runAt: map[string]time.Time{vm.ID: redisAt}})

	got := analyzer.analyzeVM(context.Background(), vm)
	if got.Decision != DecisionCandidate {
		t.Fatalf("decision = %s, reason = %s", got.Decision, got.Reason)
	}
	if !got.LastActivityAt.Equal(activityAt) || !got.DueAt.Equal(activityAt.Add(time.Hour)) {
		t.Fatalf("last activity = %v, due at = %v", got.LastActivityAt, got.DueAt)
	}
	if got.RedisRecycleAt == nil || !got.RedisRecycleAt.Equal(redisAt) {
		t.Fatalf("redis recycle at = %v", got.RedisRecycleAt)
	}
	if got.Overdue != 30*time.Minute {
		t.Fatalf("overdue = %v, want 30m", got.Overdue)
	}
}

func TestAnalyzerMarksHistoricalUncertainWhenRedisDeadlineCannotConfirm(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	taskID := uuid.New()
	vm := &db.VirtualMachine{ID: "vm-uncertain", UserID: uuid.New(), Edges: db.VirtualMachineEdges{Tasks: []*db.Task{{ID: taskID, CreatedAt: now.Add(-2 * time.Hour)}}}}

	tests := []struct {
		name      string
		deadlines *analyzerDeadlineStub
	}{
		{name: "missing", deadlines: &analyzerDeadlineStub{}},
		{name: "future", deadlines: &analyzerDeadlineStub{runAt: map[string]time.Time{vm.ID: now.Add(time.Hour)}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			analyzer := newAnalyzerForTest(now, tt.deadlines)
			got := analyzer.analyzeVM(context.Background(), vm)
			if got.Decision != DecisionHistoricalUncertain {
				t.Fatalf("decision = %s, reason = %s", got.Decision, got.Reason)
			}
		})
	}
}

func TestAnalyzerUsesLatestActivityAcrossTasks(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	oldTaskID := uuid.New()
	recentTaskID := uuid.New()
	vm := &db.VirtualMachine{ID: "vm-multi-task", UserID: uuid.New(), Edges: db.VirtualMachineEdges{Tasks: []*db.Task{
		{ID: oldTaskID, CreatedAt: now.Add(-3 * time.Hour), LastActiveAt: now.Add(-2 * time.Hour)},
		{ID: recentTaskID, CreatedAt: now.Add(-2 * time.Hour), LastActiveAt: now.Add(-30 * time.Minute)},
	}}}
	analyzer := newAnalyzerForTest(now, &analyzerDeadlineStub{runAt: map[string]time.Time{vm.ID: now.Add(-time.Hour)}})

	got := analyzer.analyzeVM(context.Background(), vm)
	if got.Decision != DecisionNotDue {
		t.Fatalf("decision = %s, want %s", got.Decision, DecisionNotDue)
	}
	if !got.LastActivityAt.Equal(now.Add(-30 * time.Minute)) {
		t.Fatalf("last activity = %v", got.LastActivityAt)
	}
}

func TestAnalyzerFallsBackToCreatedAtWhenLastActiveAtIsZero(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	taskID := uuid.New()
	vm := &db.VirtualMachine{ID: "vm-log-error", UserID: uuid.New(), Edges: db.VirtualMachineEdges{Tasks: []*db.Task{{ID: taskID, CreatedAt: now.Add(-2 * time.Hour)}}}}
	analyzer := newAnalyzerForTest(now, &analyzerDeadlineStub{runAt: map[string]time.Time{vm.ID: now.Add(-time.Minute)}})

	got := analyzer.analyzeVM(context.Background(), vm)
	if got.Decision != DecisionCandidate || !got.LastActivityAt.Equal(now.Add(-2*time.Hour)) {
		t.Fatalf("analysis = %+v", got)
	}
}

func TestAnalyzerAlreadyRecycledIsSuccessfulNoop(t *testing.T) {
	analyzer := newAnalyzerForTest(time.Now(), &analyzerDeadlineStub{})
	got := analyzer.analyzeVM(context.Background(), &db.VirtualMachine{ID: "vm-recycled", IsRecycled: true})
	if got.Decision != DecisionAlreadyRecycled || !IsSuccessfulNoop(got.Decision) {
		t.Fatalf("analysis = %+v", got)
	}
}

func TestAnalyzerDeduplicatesTaskAndVMTargets(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:vm-recycle-analyzer-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	hostID := "host-1"
	if _, err := client.Host.Create().SetID(hostID).SetUserID(userID).SetHostname("host").Save(ctx); err != nil {
		t.Fatal(err)
	}
	vmID := "vm-1"
	if _, err := client.VirtualMachine.Create().SetID(vmID).SetHostID(hostID).SetUserID(userID).SetName("vm").Save(ctx); err != nil {
		t.Fatal(err)
	}
	taskID := uuid.New()
	if _, err := client.Task.Create().
		SetID(taskID).
		SetUserID(userID).
		SetKind(consts.TaskTypeDevelop).
		SetContent("content").
		SetStatus(consts.TaskStatusProcessing).
		SetCreatedAt(now.Add(-2 * time.Hour)).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TaskVirtualMachine.Create().SetID(uuid.New()).SetTaskID(taskID).SetVirtualmachineID(vmID).Save(ctx); err != nil {
		t.Fatal(err)
	}

	analyzer := newAnalyzerForTest(now, &analyzerDeadlineStub{runAt: map[string]time.Time{vmID: now.Add(-time.Minute)}})
	analyzer.db = client
	items, err := analyzer.AnalyzeTargets(ctx, []uuid.UUID{taskID, taskID}, []string{vmID, vmID})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].VMID != vmID {
		t.Fatalf("items = %+v, want one analysis for %s", items, vmID)
	}
}

func newAnalyzerForTest(now time.Time, deadlines deadlineReader) *analyzer {
	return &analyzer{
		cfg: &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 3600}},
		teamPolicyRepo: &analyzerTeamPolicyRepoStub{team: &db.Team{
			ID:                   uuid.New(),
			TaskConcurrencyLimit: 3,
			TaskVMSleepEnabled:   true,
			TaskVMSleepSeconds:   600,
			TaskVMRecycleEnabled: true,
			TaskVMRecycleSeconds: 0,
		}},
		deadlines: deadlines,
		now:       func() time.Time { return now },
	}
}

type analyzerDeadlineStub struct {
	runAt map[string]time.Time
	err   error
}

func (s *analyzerDeadlineStub) GetRunAt(_ context.Context, _, id string) (time.Time, bool, error) {
	if s.err != nil {
		return time.Time{}, false, s.err
	}
	runAt, ok := s.runAt[id]
	return runAt, ok, nil
}

type analyzerTeamPolicyRepoStub struct {
	domain.TeamPolicyRepo
	team *db.Team
	err  error
}

func (s *analyzerTeamPolicyRepoStub) GetTeamByUserID(context.Context, uuid.UUID) (*db.Team, error) {
	return s.team, s.err
}
