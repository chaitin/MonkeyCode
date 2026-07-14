package vmrecycle

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/virtualmachine"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

const (
	analyzePageSize    = 100
	analyzeWorkerCount = 8
)

type Decision string

const (
	DecisionCandidate           Decision = "candidate"
	DecisionUnavailable         Decision = "unavailable"
	DecisionHistoricalUncertain Decision = "historical_uncertain"
	DecisionDeadlineMissing     Decision = "deadline_missing"
	DecisionOrphan              Decision = "orphan"
	DecisionNotDue              Decision = "not_due"
	DecisionDisabled            Decision = "disabled"
	DecisionAlreadyRecycled     Decision = "already_recycled"
	DecisionNotFound            Decision = "not_found"
)

type TaskInfo struct {
	ID           uuid.UUID
	Status       consts.TaskStatus
	LogStore     consts.LogStore
	CreatedAt    time.Time
	LastActiveAt time.Time
}

type Analysis struct {
	Target          string
	VMID            string
	Tasks           []TaskInfo
	LastActivityAt  time.Time
	RecycleSeconds  int
	DueAt           time.Time
	RedisRecycleAt  *time.Time
	Overdue         time.Duration
	Decision        Decision
	Reason          string
	AlreadyRecycled bool
}

type ScanReport struct {
	Items  []Analysis
	Counts map[Decision]int
}

type Analyzer interface {
	Scan(ctx context.Context) (ScanReport, error)
	AnalyzeTargets(ctx context.Context, taskIDs []uuid.UUID, vmIDs []string) ([]Analysis, error)
}

type deadlineReader interface {
	GetRunAt(ctx context.Context, queue, id string) (time.Time, bool, error)
}

type analyzer struct {
	cfg            *config.Config
	db             *db.Client
	teamPolicyRepo domain.TeamPolicyRepo
	deadlines      deadlineReader
	now            func() time.Time
}

func NewAnalyzer(i *do.Injector) (Analyzer, error) {
	return &analyzer{
		cfg:            do.MustInvoke[*config.Config](i),
		db:             do.MustInvoke[*db.Client](i),
		teamPolicyRepo: do.MustInvoke[domain.TeamPolicyRepo](i),
		deadlines:      do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		now:            time.Now,
	}, nil
}

func (a *analyzer) Scan(ctx context.Context) (ScanReport, error) {
	report := ScanReport{Counts: make(map[Decision]int)}
	cursor := ""
	for {
		query := a.db.VirtualMachine.Query().
			Where(virtualmachine.IsRecycled(false)).
			WithTasks().
			Order(db.Asc(virtualmachine.FieldID)).
			Limit(analyzePageSize)
		if cursor != "" {
			query = query.Where(func(s *sql.Selector) {
				s.Where(sql.GT(s.C(virtualmachine.FieldID), cursor))
			})
		}
		vms, err := query.All(ctx)
		if err != nil {
			return report, err
		}
		if len(vms) == 0 {
			break
		}
		items := a.analyzeBatch(ctx, vms)
		for _, item := range items {
			report.Counts[item.Decision]++
			if shouldReport(item.Decision) {
				report.Items = append(report.Items, item)
			}
		}
		cursor = vms[len(vms)-1].ID
		if len(vms) < analyzePageSize {
			break
		}
	}
	sort.Slice(report.Items, func(i, j int) bool { return report.Items[i].VMID < report.Items[j].VMID })
	return report, nil
}

func (a *analyzer) AnalyzeTargets(ctx context.Context, taskIDs []uuid.UUID, vmIDs []string) ([]Analysis, error) {
	ctx = entx.SkipSoftDelete(ctx)
	seen := make(map[string]struct{}, len(taskIDs)+len(vmIDs))
	items := make([]Analysis, 0, len(taskIDs)+len(vmIDs))
	for _, taskID := range taskIDs {
		tk, err := a.db.Task.Query().Where(task.ID(taskID)).WithVms().Only(ctx)
		if err != nil {
			if db.IsNotFound(err) {
				items = append(items, Analysis{Target: "task:" + taskID.String(), Decision: DecisionNotFound, Reason: "task not found"})
				continue
			}
			items = append(items, Analysis{Target: "task:" + taskID.String(), Decision: DecisionUnavailable, Reason: err.Error()})
			continue
		}
		if len(tk.Edges.Vms) == 0 {
			items = append(items, Analysis{Target: "task:" + taskID.String(), Decision: DecisionNotFound, Reason: "task has no VM"})
			continue
		}
		for _, vm := range tk.Edges.Vms {
			seen[vm.ID] = struct{}{}
		}
	}
	for _, vmID := range vmIDs {
		seen[vmID] = struct{}{}
	}
	uniqueIDs := make([]string, 0, len(seen))
	for vmID := range seen {
		uniqueIDs = append(uniqueIDs, vmID)
	}
	sort.Strings(uniqueIDs)
	for _, vmID := range uniqueIDs {
		vm, err := a.loadVM(ctx, vmID)
		if err != nil {
			if db.IsNotFound(err) {
				items = append(items, Analysis{Target: "vm:" + vmID, VMID: vmID, Decision: DecisionNotFound, Reason: "VM not found"})
				continue
			}
			items = append(items, Analysis{Target: "vm:" + vmID, VMID: vmID, Decision: DecisionUnavailable, Reason: err.Error()})
			continue
		}
		item := a.analyzeVM(ctx, vm)
		item.Target = "vm:" + vmID
		items = append(items, item)
	}
	return items, nil
}

func (a *analyzer) analyzeBatch(ctx context.Context, vms []*db.VirtualMachine) []Analysis {
	workers := analyzeWorkerCount
	if len(vms) < workers {
		workers = len(vms)
	}
	jobs := make(chan *db.VirtualMachine)
	results := make(chan Analysis, len(vms))
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for vm := range jobs {
				results <- a.analyzeVM(ctx, vm)
			}
		}()
	}
	go func() {
		for _, vm := range vms {
			jobs <- vm
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()
	items := make([]Analysis, 0, len(vms))
	for item := range results {
		items = append(items, item)
	}
	return items
}

func (a *analyzer) analyzeVM(ctx context.Context, vm *db.VirtualMachine) Analysis {
	item := Analysis{Target: "vm:" + vm.ID, VMID: vm.ID, AlreadyRecycled: vm.IsRecycled}
	for _, tk := range vm.Edges.Tasks {
		if tk == nil {
			continue
		}
		store := consts.LogStoreLoki
		if tk.LogStore != nil && *tk.LogStore != "" {
			store = *tk.LogStore
		}
		item.Tasks = append(item.Tasks, TaskInfo{
			ID:           tk.ID,
			Status:       tk.Status,
			LogStore:     store,
			CreatedAt:    tk.CreatedAt,
			LastActiveAt: tk.LastActiveAt,
		})
	}
	if vm.IsRecycled {
		item.Decision = DecisionAlreadyRecycled
		item.Reason = "VM already recycled"
		return item
	}
	if len(item.Tasks) == 0 {
		item.Decision = DecisionOrphan
		item.Reason = "VM has no task"
		return item
	}

	policy, err := a.resolvePolicy(ctx, vm.UserID)
	if err != nil {
		item.Decision = DecisionUnavailable
		item.Reason = fmt.Sprintf("resolve recycle policy: %v", err)
		return item
	}
	if !policy.RecycleEnabled {
		item.Decision = DecisionDisabled
		item.Reason = "recycle disabled"
		return item
	}
	item.RecycleSeconds = policy.EffectiveRecycleSeconds
	now := a.now()
	for _, tk := range item.Tasks {
		lastActivity := tk.LastActiveAt
		if lastActivity.IsZero() || lastActivity.Before(tk.CreatedAt) {
			lastActivity = tk.CreatedAt
		}
		if lastActivity.After(item.LastActivityAt) {
			item.LastActivityAt = lastActivity
		}
	}
	item.DueAt = item.LastActivityAt.Add(time.Duration(item.RecycleSeconds) * time.Second)
	redisAt, ok, err := a.deadlines.GetRunAt(ctx, RecycleQueueKey, vm.ID)
	if err != nil {
		item.Decision = DecisionUnavailable
		item.Reason = fmt.Sprintf("query redis recycle deadline: %v", err)
		return item
	}
	if ok {
		item.RedisRecycleAt = &redisAt
	}
	if item.RedisRecycleAt == nil {
		if allTasksTerminal(item.Tasks) {
			if now.Before(item.DueAt) {
				item.Decision = DecisionNotDue
				item.Reason = "activity deadline not reached"
				return item
			}
			item.Overdue = now.Sub(item.DueAt)
			item.Decision = DecisionCandidate
			item.Reason = "terminal tasks overdue and redis recycle deadline missing"
			return item
		}
		if now.After(item.DueAt) {
			item.Overdue = now.Sub(item.DueAt)
		}
		item.Decision = DecisionDeadlineMissing
		item.Reason = "active task redis recycle deadline missing"
		return item
	}
	if now.Before(item.DueAt) {
		item.Decision = DecisionNotDue
		item.Reason = "activity deadline not reached"
		return item
	}
	item.Overdue = now.Sub(item.DueAt)
	if now.Before(*item.RedisRecycleAt) {
		item.Decision = DecisionHistoricalUncertain
		item.Reason = "redis recycle deadline is still in the future"
		return item
	}
	item.Decision = DecisionCandidate
	item.Reason = "activity and redis deadlines are overdue"
	return item
}

func (a *analyzer) resolvePolicy(ctx context.Context, userID uuid.UUID) (*domain.TeamTaskVMIdlePolicy, error) {
	return resolvePolicy(ctx, a.teamPolicyRepo, a.cfg.VMIdle, userID)
}

func (a *analyzer) loadVM(ctx context.Context, vmID string) (*db.VirtualMachine, error) {
	return a.db.VirtualMachine.Query().Where(virtualmachine.ID(vmID)).WithTasks().Only(ctx)
}

func allTasksTerminal(tasks []TaskInfo) bool {
	if len(tasks) == 0 {
		return false
	}
	for _, task := range tasks {
		if task.Status != consts.TaskStatusFinished && task.Status != consts.TaskStatusError {
			return false
		}
	}
	return true
}

func shouldReport(decision Decision) bool {
	switch decision {
	case DecisionCandidate, DecisionUnavailable, DecisionHistoricalUncertain, DecisionDeadlineMissing, DecisionOrphan:
		return true
	default:
		return false
	}
}

var _ Analyzer = (*analyzer)(nil)
var _ deadlineReader = (*delayqueue.VMRecycleQueue)(nil)

func IsExecutable(decision Decision) bool {
	return decision == DecisionCandidate || decision == DecisionOrphan
}

func IsDeadlineRepairable(decision Decision) bool {
	return decision == DecisionDeadlineMissing
}

func IsSuccessfulNoop(decision Decision) bool {
	return decision == DecisionAlreadyRecycled
}
