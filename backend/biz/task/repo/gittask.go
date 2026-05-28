package repo

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/host"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// GitTaskRepo GitTask 数据访问层
type GitTaskRepo struct {
	cfg    *config.Config
	db     *db.Client
	logger *slog.Logger
}

// NewGitTaskRepo 创建 GitTaskRepo
func NewGitTaskRepo(i *do.Injector) (domain.GitTaskRepoInterface, error) {
	return &GitTaskRepo{
		cfg:    do.MustInvoke[*config.Config](i),
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.GitTaskRepo"),
	}, nil
}

// upsertUser 查找或创建 gittask 角色用户
func (g *GitTaskRepo) upsertUser(ctx context.Context, tx *db.Tx, u *domain.User) (*db.User, error) {
	// 通过 name + role=gittask 查找已有用户
	existing, err := tx.User.Query().
		Where(user.Name(u.Name), user.Role(consts.UserRoleGitTask)).
		First(ctx)
	if err == nil {
		return existing, nil
	}
	if !db.IsNotFound(err) {
		return nil, err
	}

	return tx.User.Create().
		SetAvatarURL(u.AvatarURL).
		SetEmail(u.Email).
		SetName(u.Name).
		SetRole(consts.UserRoleGitTask).
		SetStatus(consts.UserStatusActive).
		Save(ctx)
}

// Create implements domain.GitTaskRepoInterface.
func (g *GitTaskRepo) Create(ctx context.Context, req domain.CreateGitTaskReq, fn func(user *db.User, t *db.Task, m *db.Model) (*taskflow.VirtualMachine, error)) (*db.Task, error) {
	var res *db.Task
	err := entx.WithTx2(ctx, g.db, func(tx *db.Tx) error {
		h, err := tx.Host.Query().Where(host.ID(req.HostID)).First(ctx)
		if err != nil {
			return fmt.Errorf("host not found: %w", err)
		}

		mid, err := uuid.Parse(g.cfg.ReviewAgent.ModelID)
		if err != nil {
			return fmt.Errorf("failed to parse model id: %w", err)
		}

		// 查找 review 模型
		m, err := tx.Model.Query().
			Where(model.ID(mid)).
			First(ctx)
		if err != nil {
			return fmt.Errorf("review model not found")
		}

		u, err := g.upsertUser(ctx, tx, &req.User)
		if err != nil {
			return fmt.Errorf("upsert user failed: %w", err)
		}

		id := uuid.New()
		branch := "master"
		if req.Repo.Branch != nil {
			branch = *req.Repo.Branch
		}

		tk, err := tx.Task.Create().
			SetID(id).
			SetKind(consts.TaskTypeReview).
			SetSubType(consts.TaskSubTypePrReview).
			SetContent(req.Prompt).
			SetUserID(u.ID).
			SetStatus(consts.TaskStatusPending).
			SetLogStore(consts.LogStoreClickHouse).
			Save(ctx)
		if err != nil {
			return err
		}

		// 创建 GitTask 关联
		if err := tx.GitTask.Create().
			SetTaskID(tk.ID).
			SetGithubInstallationID(req.GithubInstallationID).
			SetSubjectID(req.Subject.ID).
			SetSubjectNumber(req.Subject.Number).
			SetSubjectTitle(req.Subject.Title).
			SetSubjectType(req.Subject.Type).
			SetSubjectURL(req.Subject.URL).
			Exec(ctx); err != nil {
			return err
		}

		vm, err := fn(u, tk, m)
		if err != nil {
			return err
		}
		if vm == nil {
			return fmt.Errorf("created virtual machine is nil")
		}

		expiredAt := time.Now().Add(time.Hour)
		crt := tx.VirtualMachine.Create().
			SetID(vm.ID).
			SetUserID(u.ID).
			SetHostID(h.ID).
			SetEnvironmentID(vm.EnvironmentID).
			SetExpiredAt(expiredAt).
			SetName(fmt.Sprintf("gittask-%s", id.String())).
			SetModelID(m.ID).
			SetRepoURL(req.Repo.URL).
			SetBranch(branch).
			SetCores(g.cfg.Task.Core).
			SetMemory(int64(g.cfg.Task.Memory)).
			SetCreatedAt(time.Now())
		if vm.AccessToken != "" {
			crt.SetAccessToken(vm.AccessToken)
		}
		if err := crt.Exec(ctx); err != nil {
			return fmt.Errorf("failed to create virtual machine: %w", err)
		}

		if err := tx.TaskVirtualMachine.Create().
			SetTaskID(tk.ID).
			SetVirtualmachineID(vm.ID).
			Exec(ctx); err != nil {
			return err
		}

		// 关联 GitBotTask
		if req.Bot != nil {
			if err := tx.GitBotTask.Create().
				SetGitBotID(req.Bot.ID).
				SetTaskID(tk.ID).
				Exec(ctx); err != nil {
				return err
			}
		}

		res = tk
		return nil
	})
	return res, err
}
