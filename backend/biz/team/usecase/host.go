package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/vmstatus"
)

// TeamHostUsecase 团队宿主机业务逻辑层
type TeamHostUsecase struct {
	repo     domain.TeamHostRepo
	redis    *redis.Client
	logger   *slog.Logger
	cfg      *config.Config
	taskflow taskflow.Clienter
}

// NewTeamHostUsecase 创建团队宿主机业务逻辑层实例
func NewTeamHostUsecase(i *do.Injector) (domain.TeamHostUsecase, error) {
	return &TeamHostUsecase{
		repo:     do.MustInvoke[domain.TeamHostRepo](i),
		redis:    do.MustInvoke[*redis.Client](i),
		cfg:      do.MustInvoke[*config.Config](i),
		taskflow: do.MustInvoke[taskflow.Clienter](i),
		logger:   do.MustInvoke[*slog.Logger](i).With("module", "usecase.team_host"),
	}, nil
}

// GetInstallCommand 获取宿主机安装命令
func (u *TeamHostUsecase) GetInstallCommand(ctx context.Context, teamUser *domain.TeamUser) (string, error) {
	token := uuid.NewString()
	ub, err := json.Marshal(teamUser.User)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("host:token:%s", token)
	if err := u.redis.Set(ctx, key, string(ub), 15*time.Minute).Err(); err != nil {
		return "", err
	}

	baseurl, err := url.Parse(u.cfg.Server.BaseURL)
	if err != nil {
		return "", fmt.Errorf("failed to parse baseurl [%s]", u.cfg.Server.BaseURL)
	}
	baseurl = baseurl.JoinPath("/api/v1/users/hosts/install")
	values := url.Values{}
	values.Add("token", token)
	baseurl.RawQuery = values.Encode()

	return fmt.Sprintf(`bash -c "$(curl -fsSL '%s')"`, baseurl.String()), nil
}

// List 获取团队宿主机列表
func (u *TeamHostUsecase) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamHostsResp, error) {
	hosts, err := u.repo.List(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}

	resp, err := u.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: cvt.Iter(hosts, func(_ int, h *db.Host) string {
			return h.ID
		}),
	})
	if err != nil {
		return nil, err
	}
	vmids := make([]string, 0)
	for _, host := range hosts {
		for _, vm := range host.Edges.Vms {
			vmids = append(vmids, vm.ID)
		}
	}
	vmonline, err := u.taskflow.VirtualMachiner().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
		IDs: vmids,
	})
	if err != nil {
		return nil, err
	}

	res := make([]*domain.Host, len(hosts))
	for i, host := range hosts {
		status := consts.HostStatusOffline
		if resp.OnlineMap[host.ID] {
			status = consts.HostStatusOnline
		}
		dHost := cvt.From(host, &domain.Host{
			Status: status,
		})

		dHost.VirtualMachines = cvt.Iter(host.Edges.Vms, func(_ int, vm *db.VirtualMachine) *domain.VirtualMachine {
			return cvt.From(vm, &domain.VirtualMachine{
				Status: vmstatus.Resolve(vmstatus.Input{
					Online:     vmonline.OnlineMap[vm.ID],
					Conditions: vm.Conditions.Conditions,
					IsRecycled: vm.IsRecycled,
					CreatedAt:  vm.CreatedAt,
					Now:        time.Now(),
				}),
			})
		})

		res[i] = dHost
	}

	return &domain.ListTeamHostsResp{
		Hosts: res,
	}, nil
}

// Delete 删除团队宿主机
func (u *TeamHostUsecase) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamHostReq) error {
	return u.repo.Delete(ctx, teamUser, req.HostID)
}

// Update implements domain.TeamHostUsecase.
func (u *TeamHostUsecase) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamHostReq) (*domain.Host, error) {
	host, err := u.repo.Update(ctx, teamUser, req)
	if err != nil {
		return nil, err
	}

	return cvt.From(host, &domain.Host{}), nil
}
