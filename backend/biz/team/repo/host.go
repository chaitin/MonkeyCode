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
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/host"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/db/teamgrouphost"
	"github.com/chaitin/MonkeyCode/backend/db/teamhost"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TeamHostRepo 团队宿主机数据访问层
type TeamHostRepo struct {
	db     *db.Client
	cache  *cache.Cache
	logger *slog.Logger
}

// NewTeamHostRepo 创建团队宿主机数据访问层
func NewTeamHostRepo(i *do.Injector) (domain.TeamHostRepo, error) {
	return &TeamHostRepo{
		db:     do.MustInvoke[*db.Client](i),
		cache:  cache.New(15*time.Minute, 10*time.Minute),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.team_host"),
	}, nil
}

// List 获取团队宿主机列表
func (r *TeamHostRepo) List(ctx context.Context, teamID uuid.UUID) ([]*db.Host, error) {
	ths, err := r.db.TeamHost.Query().
		WithHost(func(hq *db.HostQuery) {
			hq.WithVms(func(vmq *db.VirtualMachineQuery) {
				vmq.WithUser()
			}).
				WithGroups()
		}).
		WithTeam().
		Where(teamhost.TeamID(teamID)).
		Order(teamhost.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, err
	}
	hs := cvt.Iter(ths, func(_ int, th *db.TeamHost) *db.Host {
		return th.Edges.Host
	})
	return hs, nil
}

// Delete 删除团队宿主机
func (r *TeamHostRepo) Delete(ctx context.Context, teamUser *domain.TeamUser, hostID string) error {
	return entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		th, err := tx.TeamHost.Query().
			Where(teamhost.HostID(hostID)).
			Where(teamhost.TeamID(teamUser.GetTeamID())).
			Where(teamhost.HasTeamWith(team.HasTeamMembersWith(teammember.UserID(teamUser.User.ID)))).
			First(ctx)
		if err != nil {
			return err
		}

		if err := tx.TeamHost.DeleteOneID(th.ID).Exec(ctx); err != nil {
			return err
		}

		_, err = tx.Host.Delete().
			Where(host.ID(hostID)).
			Exec(ctx)
		if err != nil {
			return err
		}

		return nil
	})
}

// UpsertHost implements domain.TeamHostRepo.
func (r *TeamHostRepo) UpsertHost(ctx context.Context, user *domain.User, info *taskflow.Host) error {
	if info == nil || strings.HasPrefix(info.ID, "agent_") {
		return nil
	}
	uid, err := uuid.Parse(info.UserID)
	if err != nil {
		return fmt.Errorf("invalid user id %s", err)
	}

	if old, ok := r.cache.Get(info.ID); ok {
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

	return entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
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

			r.cache.Set(info.ID, &domain.Host{
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

		r.cache.Set(info.ID, &domain.Host{
			ID:         info.ID,
			Arch:       info.Arch,
			OS:         info.OS,
			Cores:      int(info.Cores),
			Memory:     info.Memory,
			Name:       info.Hostname,
			ExternalIP: info.PublicIP,
		}, 10*time.Minute)

		if err := tx.TeamHost.Create().
			SetTeamID(user.Team.ID).
			SetHostID(info.ID).
			Exec(ctx); err != nil {
			return err
		}

		return nil
	})
}

// Update implements domain.TeamHostRepo.
func (r *TeamHostRepo) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamHostReq) (*db.Host, error) {
	var res *db.Host
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		th, err := tx.TeamHost.Query().
			Where(teamhost.HostID(req.HostID)).
			Where(teamhost.TeamID(teamUser.Team.ID)).
			First(ctx)
		if err != nil {
			return errcode.ErrNotFound.Wrap(err)
		}

		// 更新宿主机备注
		upt := tx.Host.Update().Where(host.IDEQ(req.HostID))
		if req.Remark != "" {
			upt.SetRemark(req.Remark)
		}
		if err = upt.Exec(ctx); err != nil {
			return err
		}

		if _, err := tx.TeamGroupHost.Delete().
			Where(teamgrouphost.HostID(th.HostID)).
			Exec(ctx); err != nil {
			return err
		}

		creates := make([]*db.TeamGroupHostCreate, 0)
		for _, id := range req.GroupIDs {
			ct := tx.TeamGroupHost.Create().
				SetHostID(th.HostID).
				SetGroupID(id)
			creates = append(creates, ct)
		}
		if len(creates) > 0 {
			if err := tx.TeamGroupHost.CreateBulk(creates...).Exec(ctx); err != nil {
				return err
			}
		}

		res, err = tx.Host.Query().
			WithGroups().
			WithUser().
			WithVms().
			Where(host.ID(th.HostID)).
			First(ctx)
		if err != nil {
			return errcode.ErrNotFound.Wrap(err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}
