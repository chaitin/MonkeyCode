package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

type VMIdleRefresher interface {
	Refresh(ctx context.Context, vmID string) error
}

const (
	sleepQueueKey   = "vm:idle:sleep"
	notifyQueueKey  = "vm:idle:notify"
	recycleQueueKey = "vm:idle:recycle"
)

// notifySchedule 描述一档"距回收还有 lead 时"要触发的提醒，及它应当落到哪些渠道。
//
// 历史上微信公众号有独立的 2h/15m 两段提醒（产品需求：更早地提醒用户），其它渠道只在 T-1h
// 提醒一次。原实现给每档拆了独立 Redis 队列 + 独立 consumer，本结构把这种"按 channel kind
// 差异化提醒节奏"统一收敛为一份配置 + 单队列 + 单 consumer。
//
// 每档以 name 做 ZSet member key 后缀（"<vmID>:<name>"），保证各档互不覆盖。
type notifySchedule struct {
	name         string                     // 队列 member key 后缀，需稳定唯一
	lead         time.Duration              // 距回收多少时间触发
	includeKinds []consts.NotifyChannelKind // 仅这些渠道生效；空=不过滤
	excludeKinds []consts.NotifyChannelKind // 这些渠道跳过；空=不排除
	leadSeconds  int                        // 写入 event.Payload.LeadSeconds 让 sender 切文案
}

var (
	defaultRecycleWarnWechatLeadSeconds  = []int{7200, 900}
	defaultRecycleWarnDefaultLeadSeconds = 3600
)

// buildNotifySchedules 按配置生成提醒档位。微信公众号档由 cfg.RecycleWarnWechatLeadSeconds 直接展开成 N 档，
// 默认档（其它渠道）取 cfg.RecycleWarnDefaultLeadSeconds，<=0 视为禁用该档。配置缺省时回退到
// 历史硬编码值（wechat=[7200,900]、default=3600），保持升级兼容。
//
// tier name 统一格式 "wechat<N>s" / "default"，作为 Redis ZSet member key 后缀与
// event.RefID 的 dedup 分量。lookupSchedule 用 strings.HasSuffix(jobID, ":"+name) 反查，
// 因此 name 必须稳定唯一。
func buildNotifySchedules(cfg config.VMIdle) []notifySchedule {
	defaultLead := cfg.RecycleWarnDefaultLeadSeconds
	if defaultLead == 0 {
		defaultLead = defaultRecycleWarnDefaultLeadSeconds
	}
	wechatLeads := cfg.RecycleWarnWechatLeadSeconds
	if wechatLeads == nil {
		wechatLeads = defaultRecycleWarnWechatLeadSeconds
	}

	var schedules []notifySchedule
	if defaultLead > 0 {
		schedules = append(schedules, notifySchedule{
			name:         "default",
			lead:         time.Duration(defaultLead) * time.Second,
			excludeKinds: []consts.NotifyChannelKind{consts.NotifyChannelWechatMP},
			leadSeconds:  defaultLead,
		})
	}
	for _, s := range wechatLeads {
		if s <= 0 {
			continue
		}
		schedules = append(schedules, notifySchedule{
			name:         fmt.Sprintf("wechat%ds", s),
			lead:         time.Duration(s) * time.Second,
			includeKinds: []consts.NotifyChannelKind{consts.NotifyChannelWechatMP},
			leadSeconds:  s,
		})
	}
	return schedules
}

type vmIdleRefresher struct {
	cfg              *config.Config
	redis            *redis.Client
	taskflow         taskflow.Clienter
	logger           *slog.Logger
	hostRepo         domain.HostRepo
	taskRepo         domain.TaskRepo
	teamPolicyRepo   domain.TeamPolicyRepo
	notifyDispatcher *dispatcher.Dispatcher
	sleepQueue       *delayqueue.VMSleepQueue
	notifyQueue      *delayqueue.VMNotifyQueue
	recycleQueue     *delayqueue.VMRecycleQueue
	schedules        []notifySchedule
}

type vmIdleNotifyJob struct {
	MemberSuffix string
	RunAt        time.Time
	LeadSeconds  int
}

type vmIdleSchedulePlan struct {
	SleepAt    *time.Time
	RecycleAt  *time.Time
	NotifyJobs []vmIdleNotifyJob
}

func NewVMIdleRefresher(i *do.Injector) (VMIdleRefresher, error) {
	cfg := do.MustInvoke[*config.Config](i)
	r := &vmIdleRefresher{
		cfg:              cfg,
		redis:            do.MustInvoke[*redis.Client](i),
		taskflow:         do.MustInvoke[taskflow.Clienter](i),
		logger:           do.MustInvoke[*slog.Logger](i).With("module", "VMIdleRefresher"),
		hostRepo:         do.MustInvoke[domain.HostRepo](i),
		taskRepo:         do.MustInvoke[domain.TaskRepo](i),
		teamPolicyRepo:   do.MustInvoke[domain.TeamPolicyRepo](i),
		notifyDispatcher: do.MustInvoke[*dispatcher.Dispatcher](i),
		sleepQueue:       do.MustInvoke[*delayqueue.VMSleepQueue](i),
		notifyQueue:      do.MustInvoke[*delayqueue.VMNotifyQueue](i),
		recycleQueue:     do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		schedules:        buildNotifySchedules(cfg.VMIdle),
	}

	tierNames := make([]string, 0, len(r.schedules))
	for _, s := range r.schedules {
		tierNames = append(tierNames, s.name)
	}
	r.logger.Info("vm idle refresher initialized",
		"sleep_seconds", cfg.VMIdle.SleepSeconds,
		"recycle_seconds", cfg.VMIdle.RecycleSeconds,
		"recycle_warn_wechat_lead_seconds", cfg.VMIdle.RecycleWarnWechatLeadSeconds,
		"recycle_warn_default_lead_seconds", cfg.VMIdle.RecycleWarnDefaultLeadSeconds,
		"tiers", tierNames)

	go r.sleepConsumer()
	go r.notifyConsumer()
	go r.recycleConsumer()

	return r, nil
}

func (r *vmIdleRefresher) sleepDelay() time.Duration {
	return time.Duration(r.cfg.VMIdle.SleepSeconds) * time.Second
}

func (r *vmIdleRefresher) recycleDelay() time.Duration {
	return time.Duration(r.cfg.VMIdle.RecycleSeconds) * time.Second
}

func (r *vmIdleRefresher) notifyDelayFor(lead time.Duration) time.Duration {
	d := r.recycleDelay()
	if d <= lead {
		return 0
	}
	return d - lead
}

func (r *vmIdleRefresher) notifyRemainingFor(lead time.Duration) time.Duration {
	d := r.recycleDelay()
	if d <= lead {
		return d
	}
	return lead
}

func (r *vmIdleRefresher) resolvePolicyForVM(ctx context.Context, vm *db.VirtualMachine) (*domain.TeamTaskVMIdlePolicy, error) {
	if r.teamPolicyRepo == nil || vm == nil || vm.UserID == uuid.Nil {
		return domain.ResolveTeamTaskVMIdlePolicy(nil, r.cfg.VMIdle)
	}
	team, err := r.teamPolicyRepo.GetTeamByUserID(ctx, vm.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return domain.ResolveTeamTaskVMIdlePolicy(nil, r.cfg.VMIdle)
		}
		r.logger.ErrorContext(ctx, "failed to get team policy, fallback to global", "vm_id", vm.ID, "user_id", vm.UserID, "error", err)
		return domain.ResolveTeamTaskVMIdlePolicy(nil, r.cfg.VMIdle)
	}
	return domain.ResolveTeamTaskVMIdlePolicy(team, r.cfg.VMIdle)
}

func buildVMIdleSchedulePlan(policy *domain.TeamTaskVMIdlePolicy, schedules []notifySchedule) vmIdleSchedulePlan {
	now := time.Now()
	var plan vmIdleSchedulePlan
	if policy.SleepEnabled {
		sleepAt := now.Add(time.Duration(policy.EffectiveSleepSeconds) * time.Second)
		plan.SleepAt = &sleepAt
	}
	if policy.RecycleEnabled {
		recycleAt := now.Add(time.Duration(policy.EffectiveRecycleSeconds) * time.Second)
		plan.RecycleAt = &recycleAt
		for _, s := range schedules {
			delay := time.Duration(policy.EffectiveRecycleSeconds)*time.Second - s.lead
			if delay < 0 {
				delay = 0
			}
			plan.NotifyJobs = append(plan.NotifyJobs, vmIdleNotifyJob{
				MemberSuffix: s.name,
				RunAt:        now.Add(delay),
				LeadSeconds:  s.leadSeconds,
			})
		}
	}
	return plan
}

func (r *vmIdleRefresher) Refresh(ctx context.Context, vmID string) error {
	vm, err := r.hostRepo.GetVirtualMachine(ctx, vmID)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to get vm", "vmID", vmID, "error", err)
		return fmt.Errorf("get vm %s: %w", vmID, err)
	}

	if len(vm.Edges.Tasks) == 0 {
		r.logger.DebugContext(ctx, "skip idle timer for countdown VM", "vmID", vmID)
		return nil
	}

	debounceKey := fmt.Sprintf("vm:idle:debounce:%s", vmID)
	ok, err := r.redis.SetNX(ctx, debounceKey, "1", 30*time.Second).Result()
	if err != nil {
		r.logger.ErrorContext(ctx, "redis SetNX failed", "vmID", vmID, "error", err)
		return fmt.Errorf("redis debounce for vm %s: %w", vmID, err)
	}
	if !ok {
		return nil
	}

	policy, err := r.resolvePolicyForVM(ctx, vm)
	if err != nil {
		return err
	}
	plan := buildVMIdleSchedulePlan(policy, r.schedules)
	recycleAt := time.Time{}
	if plan.RecycleAt != nil {
		recycleAt = *plan.RecycleAt
	}
	payload := &domain.VmIdleInfo{
		UID:       vm.UserID,
		VmID:      vm.ID,
		HostID:    vm.HostID,
		EnvID:     vm.EnvironmentID,
		RecycleAt: recycleAt,
	}

	var errs []error
	if plan.SleepAt != nil {
		if _, err := r.sleepQueue.Enqueue(ctx, sleepQueueKey, payload, *plan.SleepAt, vmID); err != nil {
			r.logger.ErrorContext(ctx, "failed to enqueue sleep", "error", err, "vmID", vmID)
			errs = append(errs, fmt.Errorf("enqueue sleep: %w", err))
		}
	} else if err := r.sleepQueue.Remove(ctx, sleepQueueKey, vmID); err != nil {
		r.logger.ErrorContext(ctx, "failed to remove sleep", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("remove sleep: %w", err))
	}
	for _, s := range r.schedules {
		member := fmt.Sprintf("%s:%s", vmID, s.name)
		if !policy.RecycleEnabled {
			if err := r.notifyQueue.Remove(ctx, notifyQueueKey, member); err != nil {
				r.logger.ErrorContext(ctx, "failed to remove notify", "error", err, "vm_id", vmID, "tier", s.name)
				errs = append(errs, fmt.Errorf("remove notify %s: %w", s.name, err))
			}
		}
	}
	for _, job := range plan.NotifyJobs {
		// member key 带 tier name 后缀，让同一 VM 的不同档作业互不覆盖。
		member := fmt.Sprintf("%s:%s", vmID, job.MemberSuffix)
		if _, err := r.notifyQueue.Enqueue(ctx, notifyQueueKey, payload, job.RunAt, member); err != nil {
			r.logger.ErrorContext(ctx, "failed to enqueue notify", "error", err, "vm_id", vmID, "tier", job.MemberSuffix)
			errs = append(errs, fmt.Errorf("enqueue notify %s: %w", job.MemberSuffix, err))
			continue
		}
		r.logger.DebugContext(ctx, "notify tier scheduled",
			"vm_id", vmID,
			"tier", job.MemberSuffix,
			"lead_seconds", job.LeadSeconds,
			"fire_at", job.RunAt.Format(time.RFC3339))
	}
	if plan.RecycleAt != nil {
		if _, err := r.recycleQueue.Enqueue(ctx, recycleQueueKey, payload, *plan.RecycleAt, vmID); err != nil {
			r.logger.ErrorContext(ctx, "failed to enqueue recycle", "error", err, "vmID", vmID)
			errs = append(errs, fmt.Errorf("enqueue recycle: %w", err))
		}
	} else if err := r.recycleQueue.Remove(ctx, recycleQueueKey, vmID); err != nil {
		r.logger.ErrorContext(ctx, "failed to remove recycle", "error", err, "vmID", vmID)
		errs = append(errs, fmt.Errorf("remove recycle: %w", err))
	}
	return errors.Join(errs...)
}

func (r *vmIdleRefresher) sleepConsumer() {
	logger := r.logger.With("fn", "sleepConsumer")
	for {
		err := r.sleepQueue.StartConsumer(context.Background(), sleepQueueKey,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm idle sleep triggered", "vmID", job.Payload.VmID)
				vm, err := r.hostRepo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				if err := r.taskflow.VirtualMachiner().Hibernate(ctx, &taskflow.HibernateVirtualMachineReq{
					HostID:        vm.HostID,
					UserID:        vm.UserID.String(),
					ID:            vm.ID,
					EnvironmentID: vm.EnvironmentID,
				}); err != nil {
					return fmt.Errorf("hibernate vm %s: %w", vm.ID, err)
				}
				return nil
			})
		logger.Warn("sleep consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

func (r *vmIdleRefresher) notifyConsumer() {
	logger := r.logger.With("fn", "notifyConsumer")
	for {
		err := r.notifyQueue.StartConsumer(context.Background(), notifyQueueKey,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				// job.ID 形如 "<vmID>:<tier.name>"，从中解出 tier 名再 lookup schedule。
				s, ok := r.lookupSchedule(job.ID)
				if !ok {
					logger.WarnContext(ctx, "vm idle notify: unknown tier in job id, skipping", "job_id", job.ID, "vm_id", job.Payload.VmID)
					return nil
				}

				lg := logger.With("vm_id", job.Payload.VmID, "tier", s.name)
				prefix := ""
				if strings.HasPrefix(s.name, "wechat") {
					lg = lg.With("channel", "wechat_mp")
					prefix = "wechat mp: "
				}

				lg.InfoContext(ctx, prefix+"recycle notify triggered")
				vm, err := r.hostRepo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						lg.WarnContext(ctx, prefix+"vm not found, skip recycle notify")
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					lg.WarnContext(ctx, prefix+"vm already recycled, skip recycle notify")
					return nil
				}

				event, err := r.buildRecycleNotifyEvent(ctx, vm, job.Payload.RecycleAt)
				if err != nil {
					return err
				}
				if event == nil {
					lg.WarnContext(ctx, prefix+"no task bound to vm, skip recycle notify")
					return nil
				}

				event.RefID = fmt.Sprintf("%s:%s:%d", event.RefID, s.name, job.Payload.RecycleAt.Unix())
				event.Payload.LeadSeconds = s.leadSeconds
				if len(s.includeKinds) > 0 {
					event.ChannelKinds = s.includeKinds
				}
				if len(s.excludeKinds) > 0 {
					event.ExcludeKinds = s.excludeKinds
				}
				lg.DebugContext(ctx, prefix+"dispatching notify",
					"ref_id", event.RefID,
					"include_kinds", s.includeKinds,
					"exclude_kinds", s.excludeKinds)
				if err := r.notifyDispatcher.Publish(ctx, event); err != nil {
					lg.ErrorContext(ctx, prefix+"dispatcher publish failed", "error", err, "ref_id", event.RefID)
					return err
				}
				lg.DebugContext(ctx, prefix+"dispatcher publish ok", "ref_id", event.RefID)
				return nil
			})
		logger.Warn("notify consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

// lookupSchedule 从 "<vmID>:<tier.name>" 形式的 job.ID 反查档位配置。
// 用后缀匹配而非 strings.Split，避免 vmID 本身含 ":" 的边缘情况。
func (r *vmIdleRefresher) lookupSchedule(jobID string) (notifySchedule, bool) {
	for _, s := range r.schedules {
		if strings.HasSuffix(jobID, ":"+s.name) {
			return s, true
		}
	}
	return notifySchedule{}, false
}

func (r *vmIdleRefresher) recycleConsumer() {
	logger := r.logger.With("fn", "recycleConsumer")
	for {
		err := r.recycleQueue.StartConsumer(context.Background(), recycleQueueKey,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm recycle triggered", "vmID", job.Payload.VmID)

				ctx = entx.SkipSoftDelete(ctx)
				vm, err := r.hostRepo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					if db.IsNotFound(err) {
						return nil
					}
					return fmt.Errorf("get vm %s: %w", job.Payload.VmID, err)
				}
				if vm.IsRecycled {
					return nil
				}

				if err := r.hostRepo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
					vmuo.SetIsRecycled(true)
					return nil
				}); err != nil {
					return err
				}

				if err := r.markRecycledTasksFinished(ctx, vm); err != nil {
					return err
				}

				if err := r.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
					UserID: vm.UserID.String(),
					HostID: vm.HostID,
					ID:     vm.EnvironmentID,
				}); err != nil {
					return fmt.Errorf("delete vm %s: %w", vm.ID, err)
				}

				return nil
			})
		logger.Warn("recycle consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}

func (r *vmIdleRefresher) markRecycledTasksFinished(ctx context.Context, vm *db.VirtualMachine) error {
	var errs []error
	for _, tk := range vm.Edges.Tasks {
		if tk == nil {
			continue
		}
		if tk.Status == consts.TaskStatusFinished || tk.Status == consts.TaskStatusError {
			continue
		}
		err := r.taskRepo.Update(ctx, nil, tk.ID, func(up *db.TaskUpdateOne) error {
			up.SetStatus(consts.TaskStatusFinished)
			up.SetCompletedAt(time.Now())
			return nil
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("update task %s: %w", tk.ID, err))
		}
	}
	return errors.Join(errs...)
}

func (r *vmIdleRefresher) buildRecycleNotifyEvent(ctx context.Context, vm *db.VirtualMachine, expiresAt time.Time) (*domain.NotifyEvent, error) {
	// 直接按 virtualmachine_id 查 task_virtualmachines 拿 task_id，
	// 不再依赖 vm.Edges.Tasks 的 eager load 链。
	taskIDStr, err := r.hostRepo.GetTaskIDByVMID(ctx, vm.ID)
	if err != nil {
		return nil, fmt.Errorf("get task id by vm %s: %w", vm.ID, err)
	}
	if taskIDStr == "" {
		// VM 没绑任务（用户单跑环境等场景），不推送
		return nil, nil
	}
	taskID, err := uuid.Parse(taskIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid task id %q: %w", taskIDStr, err)
	}

	tk, err := r.taskRepo.GetByID(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("get task %s: %w", taskIDStr, err)
	}

	event := &domain.NotifyEvent{
		EventType:     consts.NotifyEventVMExpiringSoon,
		SubjectUserID: tk.UserID,
		RefID:         taskIDStr,
		OccurredAt:    time.Now(),
		Payload: domain.NotifyEventPayload{
			TaskID:      taskIDStr,
			TaskContent: tk.Content,
			TaskSummary: tk.Summary,
			TaskTitle:   tk.Title,
			TaskStatus:  string(tk.Status),
			TaskURL:     strings.TrimRight(r.cfg.Server.BaseURL, "/") + "/console/task/" + taskIDStr,
			VMID:        vm.ID,
			VMName:      vm.Name,
			HostID:      vm.HostID,
			VMArch:      vm.Arch,
			VMCores:     vm.Cores,
			VMMemory:    vm.Memory,
			VMOS:        vm.Os,
			ExpiresAt:   &expiresAt,
		},
	}

	if len(tk.Edges.ProjectTasks) > 0 && tk.Edges.ProjectTasks[0] != nil {
		pt := tk.Edges.ProjectTasks[0]
		event.Payload.RepoURL = pt.RepoURL
		if pt.Edges.Model != nil {
			event.Payload.ModelName = pt.Edges.Model.Model
		}
	}

	if vm.Edges.User != nil {
		event.Payload.UserName = vm.Edges.User.Name
	}

	return event, nil
}
