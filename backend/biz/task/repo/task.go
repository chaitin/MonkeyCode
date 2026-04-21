package repo

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/host"
	"github.com/chaitin/MonkeyCode/backend/db/image"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/projecttask"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/taskusagestat"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/db/virtualmachine"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TaskRepo 任务数据访问层
type TaskRepo struct {
	cfg    *config.Config
	db     *db.Client
	logger *slog.Logger
}

// NewTaskRepo 创建新的任务数据访问层实例
func NewTaskRepo(i *do.Injector) (domain.TaskRepo, error) {
	return &TaskRepo{
		cfg:    do.MustInvoke[*config.Config](i),
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.TaskRepo"),
	}, nil
}

type statsById struct {
	ID           uuid.UUID `json:"task_id"`
	InputTokens  int64     `json:"input_tokens"`
	OutputTokens int64     `json:"output_tokens"`
	TotalTokens  int64     `json:"total_tokens"`
	LLMRequests  int64     `json:"llm_requests"`
}

// Stat implements domain.TaskRepo.
func (t *TaskRepo) Stat(ctx context.Context, id uuid.UUID) (*domain.TaskStats, error) {
	var results []*domain.TaskStats
	err := t.db.TaskUsageStat.Query().
		Where(taskusagestat.TaskIDEQ(id)).
		Aggregate(
			db.As(db.Sum(taskusagestat.FieldInputTokens), "input_tokens"),
			db.As(db.Sum(taskusagestat.FieldOutputTokens), "output_tokens"),
			db.As(db.Sum(taskusagestat.FieldTotalTokens), "total_tokens"),
			db.As(db.Count(), "llm_requests"),
		).
		Scan(ctx, &results)
	if err != nil {
		return nil, err
	}
	if len(results) > 0 {
		return results[0], nil
	}
	return nil, nil
}

// StatByIDs implements domain.TaskRepo.
func (t *TaskRepo) StatByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*domain.TaskStats, error) {
	var results []*statsById
	err := t.db.TaskUsageStat.Query().
		Where(taskusagestat.TaskIDIn(ids...)).
		Modify(func(s *sql.Selector) {
			s.Select(
				"task_id",
				sql.As(sql.Sum(s.C(taskusagestat.FieldInputTokens)), "input_tokens"),
				sql.As(sql.Sum(s.C(taskusagestat.FieldOutputTokens)), "output_tokens"),
				sql.As(sql.Sum(s.C(taskusagestat.FieldTotalTokens)), "total_tokens"),
				sql.As(sql.Count("*"), "llm_requests"),
			).
				GroupBy(s.C(taskusagestat.FieldTaskID))
		}).
		Scan(ctx, &results)
	if err != nil {
		return nil, err
	}

	return cvt.IterToMap(results, func(_ int, s *statsById) (uuid.UUID, *domain.TaskStats) {
		return s.ID, &domain.TaskStats{
			InputTokens:  s.InputTokens,
			OutputTokens: s.OutputTokens,
			TotalTokens:  s.TotalTokens,
			LLMRequests:  s.LLMRequests,
		}
	}), nil
}

// GetByID implements domain.TaskRepo.
func (t *TaskRepo) GetByID(ctx context.Context, id uuid.UUID) (*db.Task, error) {
	return t.db.Task.Query().
		WithUser().
		WithProjectTasks(func(ptq *db.ProjectTaskQuery) {
			ptq.
				WithModel().
				WithImage().
				WithTask(func(tq *db.TaskQuery) {
					tq.WithVms(func(vmq *db.VirtualMachineQuery) {
						vmq.WithHost()
					})
				})
		}).
		WithVms(func(vmq *db.VirtualMachineQuery) {
			vmq.WithHost(func(hq *db.HostQuery) {
				hq.WithUser()
			})
		}).
		Where(task.ID(id)).
		First(ctx)
}

// Info implements domain.TaskRepo.
func (t *TaskRepo) Info(ctx context.Context, u *domain.User, id uuid.UUID, isPrivileged bool) (*db.Task, error) {
	q := t.db.Task.Query().
		WithProjectTasks(func(ptq *db.ProjectTaskQuery) {
			ptq.
				WithModel().
				WithImage().
				WithTask(func(tq *db.TaskQuery) {
					tq.WithVms(func(vmq *db.VirtualMachineQuery) {
						vmq.WithHost()
					})
				})
		}).
		WithVms(func(vmq *db.VirtualMachineQuery) {
			vmq.WithHost(func(hq *db.HostQuery) {
				hq.WithUser()
			})
		}).
		Where(task.ID(id))

	if !isPrivileged {
		q = q.Where(task.UserID(u.ID))
	}

	return q.First(ctx)
}

// List implements domain.TaskRepo.
func (t *TaskRepo) List(ctx context.Context, u *domain.User, req domain.TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error) {
	query := t.db.Task.Query().
		Where(task.UserID(u.ID)).
		Order(task.ByCreatedAt(sql.OrderDesc()))
	if req.QuickStart {
		query = query.Where(task.HasProjectTasksWith(projecttask.ProjectIDIsNil()))
	} else if req.ProjectID != uuid.Nil {
		query = query.Where(task.HasProjectTasksWith(projecttask.ProjectIDEQ(req.ProjectID)))
	}

	if req.Status != nil {
		if ss := strings.Split(*req.Status, ","); len(ss) > 0 {
			query = query.Where(task.StatusIn(cvt.Iter(ss, func(_ int, s string) consts.TaskStatus {
				return consts.TaskStatus(s)
			})...))
		}
	}

	page, size := req.Page, req.Size
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 100
	}
	tasks, pageInfo, err := query.Page(ctx, page, size)
	if err != nil {
		return nil, nil, err
	}
	if len(tasks) == 0 {
		return []*db.ProjectTask{}, pageInfo, nil
	}

	// 获取任务 ID 列表
	taskIDs := make([]uuid.UUID, len(tasks))
	for i, tk := range tasks {
		taskIDs[i] = tk.ID
	}

	// 通过 ProjectTask 查询关联的任务信息
	projectTasks, err := t.db.ProjectTask.Query().
		WithModel().
		WithImage().
		WithTask(func(tq *db.TaskQuery) {
			tq.WithVms(func(vmq *db.VirtualMachineQuery) { vmq.WithHost() })
		}).
		Where(projecttask.HasTaskWith(task.IDIn(taskIDs...))).
		All(ctx)
	if err != nil {
		return nil, nil, err
	}

	// 构建 taskID -> ProjectTask 的映射
	taskMap := make(map[uuid.UUID]*db.ProjectTask)
	for _, pt := range projectTasks {
		if pt.Edges.Task != nil {
			taskMap[pt.Edges.Task.ID] = pt
		}
	}

	// 按照 tasks 的顺序（创建时间倒序）构建结果
	result := make([]*db.ProjectTask, 0, len(tasks))
	for _, tk := range tasks {
		if pt, ok := taskMap[tk.ID]; ok {
			result = append(result, pt)
		}
	}

	return result, pageInfo, nil
}

// Stop implements domain.TaskRepo.
func (t *TaskRepo) Stop(ctx context.Context, u *domain.User, id uuid.UUID, fn func(*db.Task) error) error {
	return entx.WithTx2(ctx, t.db, func(tx *db.Tx) error {
		tk, err := tx.Task.Query().
			WithProjectTasks().
			WithVms().
			Where(task.ID(id)).
			Where(task.UserID(u.ID)).
			First(ctx)
		if err != nil {
			return err
		}

		if err := fn(tk); err != nil {
			return err
		}

		return tx.Task.UpdateOneID(tk.ID).
			SetStatus(consts.TaskStatusFinished).
			SetCompletedAt(time.Now()).
			Exec(ctx)
	})
}

// Update implements domain.TaskRepo.
func (t *TaskRepo) Update(ctx context.Context, _ *domain.User, id uuid.UUID, fn func(up *db.TaskUpdateOne) error) error {
	return entx.WithTx2(ctx, t.db, func(tx *db.Tx) error {
		up := tx.Task.UpdateOneID(id)
		if err := fn(up); err != nil {
			return err
		}
		return up.Exec(ctx)
	})
}

func (t *TaskRepo) RefreshLastActiveAt(ctx context.Context, id uuid.UUID, at time.Time, minInterval time.Duration) error {
	up := t.db.Task.Update().Where(task.ID(id))
	if minInterval > 0 {
		up = up.Where(task.LastActiveAtLT(at.Add(-minInterval)))
	}
	_, err := up.SetLastActiveAt(at).Save(ctx)
	return err
}

// Delete implements domain.TaskRepo.
func (t *TaskRepo) Delete(ctx context.Context, user *domain.User, id uuid.UUID) error {
	_, err := t.db.Task.Delete().
		Where(task.UserID(user.ID)).
		Where(task.ID(id)).
		Exec(ctx)
	return err
}

// Create implements domain.TaskRepo.
func (t *TaskRepo) Create(ctx context.Context, u *domain.User, req domain.CreateTaskReq, token string, fn func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error) {
	resource := req.Resource

	var res *db.ProjectTask
	err := entx.WithTx2(ctx, t.db, func(tx *db.Tx) error {
		h, err := tx.Host.Query().Where(host.ID(req.HostID)).First(ctx)
		if err != nil {
			return err
		}

		if req.UsePublicHost {
			cnt, err := tx.VirtualMachine.Query().
				Where(virtualmachine.UserID(u.ID)).
				Where(virtualmachine.HasHostWith(host.HasUserWith(user.Role(consts.UserRoleAdmin)))).
				Where(func(s *sql.Selector) {
					s.Where(sql.P(func(b *sql.Builder) {
						b.WriteString("NOW()").
							WriteOp(sql.OpLT).
							Ident(s.C(virtualmachine.FieldCreatedAt)).
							WriteOp(sql.OpAdd).
							WriteString("make_interval(secs => ").
							Ident(s.C(virtualmachine.FieldTTL)).
							WriteByte(')')
					}))
				}).
				Count(ctx)
			if err != nil {
				return errcode.ErrDatabaseOperation.Wrap(err)
			}
			if cnt >= t.cfg.PublicHost.CountLimit {
				return errcode.ErrPublicHostBeyondLimit.Wrap(fmt.Errorf("public host limit reached"))
			}
		}

		mid, err := uuid.Parse(req.ModelID)
		if err != nil {
			return errcode.ErrModelAccessDenied.Wrap(err)
		}
		m, err := tx.Model.Query().
			WithPricing().
			WithUser().
			Where(model.ID(mid)).
			First(ctx)
		if err != nil {
			return err
		}

		var mak *db.ModelApiKey
		if p := m.Edges.Pricing; p != nil {
			apikey := uuid.NewString()
			mak, err = tx.ModelApiKey.Create().
				SetAPIKey(apikey).
				SetUserID(u.ID).
				SetModelID(m.ID).
				Save(ctx)
			if err != nil {
				return err
			}
			m.Edges.Apikeys = append(m.Edges.Apikeys, mak)
		}

		img, err := tx.Image.Query().Where(image.ID(req.ImageID)).First(ctx)
		if err != nil {
			return err
		}

		id := uuid.New()
		tk, err := tx.Task.Create().
			SetID(id).
			SetKind(req.Type).
			SetSubType(req.SubType).
			SetContent(req.Content).
			SetUserID(u.ID).
			SetStatus(consts.TaskStatusPending).
			Save(ctx)
		if err != nil {
			return err
		}

		if tk == nil {
			return fmt.Errorf("created task is nil")
		}

		crt := tx.ProjectTask.Create().
			SetImageID(img.ID).
			SetModelID(m.ID).
			SetTaskID(tk.ID).
			SetRepoURL(req.RepoReq.RepoURL).
			SetRepoFilename(req.RepoReq.RepoFilename).
			SetBranch(req.RepoReq.Branch).
			SetCliName(req.CliName)

		if req.GitIdentityID != uuid.Nil {
			crt.SetGitIdentityID(req.GitIdentityID)
		}
		if req.Extra.ProjectID != uuid.Nil {
			crt.SetProjectID(req.Extra.ProjectID)
		}
		if req.Extra.IssueID != uuid.Nil {
			crt.SetIssueID(req.Extra.IssueID)
		}
		pt, err := crt.Save(ctx)
		if err != nil {
			return err
		}
		pt.Edges.Task = tk
		pt.Edges.Model = m
		pt.Edges.Image = img
		res = pt

		vm, err := fn(pt, m, img)
		if err != nil {
			return err
		}
		if vm == nil {
			return fmt.Errorf("created virtual machine is nil")
		}

		if err := tx.VirtualMachine.Create().
			SetID(vm.ID).
			SetUserID(u.ID).
			SetName(fmt.Sprintf("task-%s", id.String())).
			SetHostID(h.ID).
			SetEnvironmentID(vm.EnvironmentID).
			SetTTLKind(consts.Forever).
			SetTTL(0).
			SetCores(resource.Core).
			SetMemory(int64(resource.Memory)).
			SetModelID(m.ID).
			SetCreatedAt(req.Now).
			SetRepoURL(req.RepoReq.RepoURL).
			SetRepoFilename(req.RepoReq.RepoFilename).
			SetBranch(req.RepoReq.Branch).
			Exec(ctx); err != nil {
			return fmt.Errorf("failed to create virtual machine %s", err)
		}

		tvm := tx.TaskVirtualMachine.Create().
			SetTaskID(tk.ID).
			SetVirtualmachineID(vm.ID)
		if err := tvm.Exec(ctx); err != nil {
			return err
		}

		if mak != nil {
			if err := tx.ModelApiKey.UpdateOneID(mak.ID).
				SetVirtualmachineID(vm.ID).
				Exec(ctx); err != nil {
				return err
			}
		}

		return nil
	})

	return res, err
}
