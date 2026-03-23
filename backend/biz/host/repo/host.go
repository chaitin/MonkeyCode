package repo

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/patrickmn/go-cache"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/host"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/db/virtualmachine"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

type HostRepo struct {
	db     *db.Client
	cache  *cache.Cache
	logger *slog.Logger
	cfg    *config.Config
	redis  *redis.Client
}

func NewHostRepo(i *do.Injector) (domain.HostRepo, error) {
	return &HostRepo{
		db:     do.MustInvoke[*db.Client](i),
		cfg:    do.MustInvoke[*config.Config](i),
		cache:  cache.New(15*time.Minute, 10*time.Minute),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.HostRepo"),
		redis:  do.MustInvoke[*redis.Client](i),
	}, nil
}

func hostWithUserPredicate(uid uuid.UUID) predicate.Host {
	return host.Or(
		host.UserID(uid),
		host.HasGroupsWith(teamgroup.HasMembersWith(user.ID(uid))),
		host.HasUserWith(user.Role(consts.UserRoleAdmin)),
	)
}

// List implements domain.HostRepo.
func (h *HostRepo) List(ctx context.Context, uid uuid.UUID) ([]*db.Host, error) {
	return h.db.Host.Query().
		WithVms(func(vmq *db.VirtualMachineQuery) {
			vmq.WithUser().
				Where(virtualmachine.UserID(uid)).
				Order(virtualmachine.ByCreatedAt(sql.OrderDesc()))
		}).
		WithUser().
		WithGroups(func(tgq *db.TeamGroupQuery) {
			tgq.WithTeam()
		}).
		Where(hostWithUserPredicate(uid)).
		Order(host.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
}

// GetHost implements domain.HostRepo.
func (h *HostRepo) GetHost(ctx context.Context, uid uuid.UUID, id string) (*domain.Host, error) {
	dbHost, err := h.db.Host.Query().
		Where(hostWithUserPredicate(uid)).
		Where(host.ID(id)).
		First(ctx)
	if err != nil {
		return nil, err
	}
	return cvt.From(dbHost, &domain.Host{}), nil
}

// UpsertVirtualMachine implements domain.HostRepo.
func (h *HostRepo) UpsertVirtualMachine(ctx context.Context, vm *taskflow.VirtualMachine) error {
	if vm == nil {
		return nil
	}

	if old, ok := h.cache.Get(vm.ID); ok {
		if oldInfo, ok := old.(*taskflow.VirtualMachine); ok {
			if oldInfo.Arch == vm.Arch &&
				oldInfo.Cores == vm.Cores &&
				oldInfo.OS == vm.OS &&
				oldInfo.Hostname == vm.Hostname &&
				oldInfo.Memory == uint64(vm.Memory) &&
				oldInfo.Version == vm.Version {
				return nil
			}
		}
	}

	return entx.WithTx2(ctx, h.db, func(tx *db.Tx) error {
		if oldVm, err := tx.VirtualMachine.Query().
			ForUpdate().
			Where(virtualmachine.ID(vm.ID)).
			First(ctx); err == nil {
			if err := tx.VirtualMachine.UpdateOneID(vm.ID).
				SetArch(vm.Arch).
				SetCores(int(vm.Cores)).
				SetHostname(vm.Hostname).
				SetOs(vm.OS).
				SetMemory(int64(vm.Memory)).
				SetVersion(vm.Version).
				Exec(ctx); err != nil {
				return err
			}
			vm.EnvironmentID = oldVm.EnvironmentID
			h.cache.Set(vm.ID, vm, 10*time.Minute)
			return nil
		}
		return nil
	})
}

// UpsertHost implements domain.HostRepo.
func (h *HostRepo) UpsertHost(ctx context.Context, info *taskflow.Host) error {
	if info == nil || strings.HasPrefix(info.ID, "agent_") {
		return nil
	}
	uid, err := uuid.Parse(info.UserID)
	if err != nil {
		return fmt.Errorf("invalid user id %s", err)
	}

	if old, ok := h.cache.Get(info.ID); ok {
		if oldInfo, ok := old.(*domain.Host); ok {
			if oldInfo.Arch == info.Arch &&
				oldInfo.Cores == int(info.Cores) &&
				oldInfo.Name == info.Hostname &&
				oldInfo.ExternalIP == info.PublicIP &&
				oldInfo.OS == info.OS &&
				oldInfo.Memory == uint64(info.Memory) &&
				oldInfo.Version == info.Version {
				return nil
			}
		}
	}

	return entx.WithTx2(ctx, h.db, func(tx *db.Tx) error {
		if _, err := tx.Host.Query().Where(host.ID(info.ID)).First(ctx); err == nil {
			if err := tx.Host.UpdateOneID(info.ID).
				SetArch(info.Arch).
				SetCores(int(info.Cores)).
				SetOs(info.OS).
				SetHostname(info.Hostname).
				SetMemory(int64(info.Memory)).
				SetExternalIP(info.PublicIP).
				SetInternalIP(info.InternalIP).
				SetHostname(info.Hostname).
				SetVersion(info.Version).
				Exec(ctx); err != nil {
				return err
			}

			h.cache.Set(info.ID, &domain.Host{
				ID:         info.ID,
				Arch:       info.Arch,
				Cores:      int(info.Cores),
				OS:         info.OS,
				Memory:     info.Memory,
				Name:       info.Hostname,
				ExternalIP: info.PublicIP,
				Version:    info.Version,
			}, 10*time.Minute)

			return nil
		}

		if err := tx.Host.Create().
			SetID(info.ID).
			SetUserID(uid).
			SetArch(info.Arch).
			SetCores(int(info.Cores)).
			SetOs(info.OS).
			SetHostname(info.Hostname).
			SetMemory(int64(info.Memory)).
			SetExternalIP(info.PublicIP).
			SetInternalIP(info.InternalIP).
			SetHostname(info.Hostname).
			Exec(ctx); err != nil {
			return err
		}

		h.cache.Set(info.ID, &domain.Host{
			ID:         info.ID,
			Arch:       info.Arch,
			OS:         info.OS,
			Cores:      int(info.Cores),
			Memory:     info.Memory,
			Name:       info.Hostname,
			ExternalIP: info.PublicIP,
		}, 10*time.Minute)

		return nil
	})
}

// GetVirtualMachineWithUser implements domain.HostRepo.
func (h *HostRepo) GetVirtualMachineWithUser(ctx context.Context, uid uuid.UUID, id string) (*db.VirtualMachine, error) {
	vm, err := h.db.VirtualMachine.Query().
		ForUpdate().
		WithHost().
		WithModel().
		WithTasks().
		WithUser().
		Where(virtualmachine.HasHostWith(hostWithUserPredicate(uid))).
		Where(virtualmachine.UserID(uid)).
		Where(virtualmachine.ID(id)).
		First(ctx)
	if err != nil {
		return nil, err
	}

	return vm, nil
}

// GetVirtualMachine implements domain.HostRepo.
func (h *HostRepo) GetVirtualMachine(ctx context.Context, id string) (*db.VirtualMachine, error) {
	vm, err := h.db.VirtualMachine.Query().
		ForUpdate().
		WithHost().
		WithModel().
		WithTasks().
		WithUser().
		Where(virtualmachine.ID(id)).
		First(ctx)
	if err != nil {
		return nil, err
	}

	return vm, nil
}

// GetByID implements domain.HostRepo.
func (h *HostRepo) GetByID(ctx context.Context, id string) (*db.Host, error) {
	dbHost, err := h.db.Host.Query().
		Where(host.ID(id)).
		First(ctx)
	if err != nil {
		return nil, err
	}
	return dbHost, nil
}

// DeleteHost implements domain.HostRepo.
func (h *HostRepo) DeleteHost(ctx context.Context, uid uuid.UUID, id string) error {
	_, err := h.db.Host.Query().
		Where(host.UserID(uid)).
		Where(host.ID(id)).
		First(ctx)
	if err != nil {
		return errcode.ErrPermision.Wrap(err)
	}

	_, err = h.db.Host.Delete().
		Where(host.UserID(uid)).
		Where(host.ID(id)).
		Exec(ctx)
	if err != nil {
		return errcode.ErrDatabaseOperation.Wrap(err)
	}

	return nil
}

// CreateVirtualMachine implements domain.HostRepo.
func (h *HostRepo) CreateVirtualMachine(ctx context.Context, u *domain.User, req *domain.CreateVMReq, getRepoToken func(context.Context) (string, error), fn func(*db.Model, *db.Image) (*domain.VirtualMachine, error)) (*domain.VirtualMachine, error) {
	var res *domain.VirtualMachine
	err := entx.WithTx2(ctx, h.db, func(tx *db.Tx) error {
		dbHost, err := tx.Host.Query().
			WithGroups().
			Where(hostWithUserPredicate(u.ID)).
			Where(host.ID(req.HostID)).
			First(ctx)
		if err != nil {
			return errcode.ErrPermision.Wrap(err)
		}

		if len(dbHost.Edges.Groups) > 0 && (req.Life <= 0 || req.Life > 7*24*60*60) {
			return errcode.ErrVmBeyondExpireTime.Wrap(fmt.Errorf("团队宿主机不支持创建永久虚拟机"))
		}

		// 公共主机数量限制（仅在配置了 CountLimit 时生效）
		if req.UsePublicHost && h.cfg.PublicHost.CountLimit > 0 {
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
			if cnt >= h.cfg.PublicHost.CountLimit {
				return errcode.ErrPublicHostBeyondLimit.Wrap(fmt.Errorf("public host limit reached: %d", h.cfg.PublicHost.CountLimit))
			}
		}

		var m *db.Model
		if len(req.ModelID) > 0 {
			switch req.ModelID {
			case "economy":
				m, err = tx.Model.Query().
					WithUser().
					Where(model.HasUserWith(user.Role(consts.UserRoleAdmin))).
					Where(model.Remark(req.ModelID)).
					First(ctx)
				if err != nil {
					return err
				}
			default:
				mid, err := uuid.Parse(req.ModelID)
				if err != nil {
					return err
				}
				m, err = tx.Model.Query().WithUser().Where(model.ID(mid)).First(ctx)
				if err != nil {
					return err
				}
			}
		}

		repoURL := ""
		repoFilename := ""
		branch := ""
		if req.RepoReq != nil {
			repoURL = req.RepoReq.RepoURL
			repoFilename = req.RepoReq.RepoFilename
			branch = req.RepoReq.Branch
		}

		image, err := tx.Image.Get(ctx, req.ImageID)
		if err != nil {
			return err
		}

		vm, err := fn(m, image)
		if err != nil {
			return err
		}
		res = vm

		kind := consts.CountDown
		if req.Life <= 0 {
			kind = consts.Forever
		}

		crt := tx.VirtualMachine.Create().
			SetID(vm.ID).
			SetUserID(u.ID).
			SetEnvironmentID(vm.EnvironmentID).
			SetName(vm.Name).
			SetHostID(vm.Host.ID).
			SetTTLKind(kind).
			SetTTL(req.Life).
			SetCores(req.Resource.CPU).
			SetMemory(req.Resource.Memory).
			SetRepoURL(repoURL).
			SetRepoFilename(repoFilename).
			SetBranch(branch).
			SetCreatedAt(req.Now)

		if len(req.ModelID) > 0 {
			crt.SetModelID(m.ID)
		}
		if err := crt.Exec(ctx); err != nil {
			return err
		}
		return nil
	})
	return res, err
}

// DeleteVirtualMachine implements domain.HostRepo.
func (h *HostRepo) DeleteVirtualMachine(ctx context.Context, uid uuid.UUID, hostID, id string, fn func(*db.VirtualMachine) error) error {
	return entx.WithTx2(ctx, h.db, func(tx *db.Tx) error {
		vm, err := tx.VirtualMachine.Query().
			Where(virtualmachine.ID(id)).
			Where(virtualmachine.UserID(uid)).
			First(ctx)
		if err != nil {
			return err
		}

		if err := fn(vm); err != nil {
			return err
		}

		_, err = tx.VirtualMachine.Delete().Where(virtualmachine.ID(id)).Exec(ctx)
		if err != nil {
			return err
		}
		return nil
	})
}

// UpdateVirtualMachine implements domain.HostRepo.
func (h *HostRepo) UpdateVirtualMachine(ctx context.Context, id string, fn func(*db.VirtualMachineUpdateOne) error) error {
	return entx.WithTx2(ctx, h.db, func(tx *db.Tx) error {
		old, err := tx.VirtualMachine.Get(ctx, id)
		if err != nil {
			return err
		}
		up := tx.VirtualMachine.UpdateOneID(old.ID)
		if err := fn(up); err != nil {
			return err
		}

		return up.Exec(ctx)
	})
}

// UpdateHost implements domain.HostRepo.
func (h *HostRepo) UpdateHost(ctx context.Context, uid uuid.UUID, req *domain.UpdateHostReq) error {
	return entx.WithTx2(ctx, h.db, func(tx *db.Tx) error {
		_, err := tx.Host.Query().
			Where(hostWithUserPredicate(uid)).
			Where(host.ID(req.ID)).
			First(ctx)
		if err != nil {
			return errcode.ErrPermision.Wrap(err)
		}

		upt := tx.Host.Update().
			Where(host.UserID(uid)).
			Where(host.ID(req.ID))
		if req.Remark != "" {
			upt.SetRemark(req.Remark)
		}
		if req.Weight != nil {
			upt.SetWeight(*req.Weight)
		}
		err = upt.Exec(ctx)
		if err != nil {
			return err
		}

		// 默认主机配置
		if req.IsDefault {
			u, err := tx.User.Get(ctx, uid)
			if err != nil {
				return err
			}
			defaultConfigs := u.DefaultConfigs
			if defaultConfigs == nil {
				defaultConfigs = make(map[consts.DefaultConfigType]uuid.UUID)
			}
			defaultConfigs[consts.DefaultConfigTypeHost] = uuid.MustParse(req.ID)
			err = tx.User.UpdateOneID(uid).
				SetDefaultConfigs(defaultConfigs).
				Exec(ctx)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// PastHourVirtualMachine implements domain.HostRepo.
func (h *HostRepo) PastHourVirtualMachine(ctx context.Context) ([]*db.VirtualMachine, error) {
	return h.db.VirtualMachine.Query().
		Where(virtualmachine.TTLKind(consts.CountDown)).
		Where(virtualmachine.IsRecycled(false)).
		Where(virtualmachine.CreatedAtGTE(time.Now().Add(-24 * time.Hour))).
		All(ctx)
}

// AllCountDownVirtualMachine implements domain.HostRepo.
func (h *HostRepo) AllCountDownVirtualMachine(ctx context.Context) ([]*db.VirtualMachine, error) {
	return h.db.VirtualMachine.Query().
		Where(virtualmachine.TTLKind(consts.CountDown)).
		Where(virtualmachine.IsRecycled(false)).
		All(ctx)
}

// UpdateVM implements domain.HostRepo.
func (h *HostRepo) UpdateVM(ctx context.Context, req domain.UpdateVMReq, fn func(*db.VirtualMachine) error) (*db.VirtualMachine, int64, error) {
	var res *db.VirtualMachine
	actualLife := req.Life
	err := entx.WithTx2(ctx, h.db, func(tx *db.Tx) error {
		vm, err := tx.VirtualMachine.Query().
			WithHost(func(hq *db.HostQuery) {
				hq.WithUser()
			}).
			Where(virtualmachine.ID(req.ID)).
			Where(virtualmachine.UserID(req.UID)).
			First(ctx)
		if err != nil {
			return errcode.ErrDatabaseOperation.Wrap(err)
		}

		// 公共主机 TTL 续期上限（仅在配置了 TTLLimit 时生效）
		if req.Life > 0 && h.cfg.PublicHost.TTLLimit > 0 {
			if vm.Edges.Host != nil && vm.Edges.Host.Edges.User != nil &&
				vm.Edges.Host.Edges.User.Role == consts.UserRoleAdmin {
				now := time.Now()
				expiredAt := vm.CreatedAt.Add(time.Duration(vm.TTL) * time.Second)
				remaining := max(int64(expiredAt.Sub(now).Seconds()), 0)
				maxAdditional := max(h.cfg.PublicHost.TTLLimit-remaining, 0)
				actualLife = min(req.Life, maxAdditional)
			}
		}

		res = vm
		if vm.TTLKind == consts.Forever {
			return nil
		}

		expiredAt := vm.CreatedAt.Add(time.Duration(vm.TTL) * time.Second)
		if expiredAt.Before(time.Now()) {
			return errcode.ErrVMExpired
		}

		vm, err = tx.VirtualMachine.UpdateOneID(vm.ID).
			AddTTL(actualLife).
			Save(ctx)
		if err != nil {
			return errcode.ErrDatabaseOperation.Wrap(err)
		}
		res = vm
		return fn(vm)
	})
	return res, actualLife, err
}

// GetVirtualMachineByEnvID implements domain.HostRepo.
func (h *HostRepo) GetVirtualMachineByEnvID(ctx context.Context, envID string) (*db.VirtualMachine, error) {
	return h.db.VirtualMachine.Query().
		WithTasks().
		Where(virtualmachine.EnvironmentID(envID)).
		First(ctx)
}
