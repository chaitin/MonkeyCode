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
	"github.com/chaitin/MonkeyCode/backend/db/image"
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
func (g *GitTaskRepo) Create(ctx context.Context, req domain.CreateGitTaskReq, fn func(user *db.User, t *db.Task, m *db.Model, i *db.Image) (*taskflow.VirtualMachine, error)) (*db.Task, error) {
	var res *db.Task
	err := entx.WithTx2(ctx, g.db, func(tx *db.Tx) error {
		h, err := tx.Host.Query().Where(host.ID(req.HostID)).First(ctx)
		if err != nil {
			return fmt.Errorf("host not found: %w", err)
		}

		// 查找 review 模型
		ms, err := tx.Model.Query().
			Where(model.Remark("review")).
			Where(model.HasUserWith(user.Role(consts.UserRoleAdmin))).
			All(ctx)
		if err != nil || len(ms) == 0 {
			return fmt.Errorf("review model not found")
		}
		m := ms[0]

		img, err := tx.Image.Query().Where(image.ID(req.ImageID)).First(ctx)
		if err != nil {
			return fmt.Errorf("image not found: %w", err)
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
			Save(ctx)
		if err != nil {
			return err
		}

		// 创建 ProjectTask 关联
		pt, err := tx.ProjectTask.Create().
			SetImageID(img.ID).
			SetModelID(m.ID).
			SetTaskID(tk.ID).
			SetRepoURL(req.Repo.URL).
			SetBranch(branch).
			SetCliName(consts.CliNameClaude).
			Save(ctx)
		if err != nil {
			return err
		}
		_ = pt

		vm, err := fn(u, tk, m, img)
		if err != nil {
			return err
		}
		if vm == nil {
			return fmt.Errorf("created virtual machine is nil")
		}

		if err := tx.VirtualMachine.Create().
			SetID(vm.ID).
			SetUserID(u.ID).
			SetHostID(h.ID).
			SetEnvironmentID(vm.EnvironmentID).
			SetTTL(60 * 60).
			SetTTLKind(consts.CountDown).
			SetName(fmt.Sprintf("gittask-%s", id.String())).
			SetModelID(m.ID).
			SetRepoURL(req.Repo.URL).
			SetBranch(branch).
			SetCores(g.cfg.Task.Core).
			SetMemory(int64(g.cfg.Task.Memory)).
			SetCreatedAt(time.Now()).
			Exec(ctx); err != nil {
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
