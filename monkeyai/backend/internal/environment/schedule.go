package environment

import (
	"context"
	"encoding/json"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

type placement struct {
	HostID, Architecture, Image, ImageDigest string
	Resource                                 Resources
}

// 数量检查及创建受同一事务锁保护，硬件资源总量不参与准入。
func (s *Service) schedule(ctx context.Context, q *sqlc.Queries, tx pgx.Tx, user, requested string) (placement, error) {
	var selected placement
	if requested != "" {
		if err := hostAllowed(ctx, tx, requested, user); err != nil {
			return selected, err
		}
	}
	candidates, err := q.AvailableHosts(ctx, sqlc.AvailableHostsParams{NetworkPolicy: "public-only", RuntimeRequired: s.runtime != nil})
	if err != nil {
		return selected, err
	}
	var chosen *sqlc.AvailableHostsRow
	var lastErr error
	authorized := false
	for i := range candidates {
		h := &candidates[i]
		if requested != "" && h.HostID != requested {
			continue
		}
		allowed, err := resource.Allowed(ctx, tx, "host", h.HostID, user)
		if err != nil {
			return selected, err
		}
		if !allowed {
			continue
		}
		authorized = true
		if h.EnvironmentCount >= int64(h.MaxEnvironments) {
			continue
		}
		var r Resources
		if json.Unmarshal(h.Resource, &r) != nil || r.Validate() != nil {
			continue
		}
		if err = reserveUser(ctx, q, user, h.HostID); err != nil {
			lastErr = err
			continue
		}
		if err = s.billingAdmission(ctx, q, tx, user, h.HostID); err != nil {
			lastErr = err
			continue
		}
		reference, digest, err := s.defaultImage(ctx, h.Architecture)
		if err != nil {
			lastErr = conflict("configuration_unavailable", "server 默认镜像尚未准备完成")
			continue
		}
		var report struct {
			Protocol        int `json:"environment_protocol"`
			RuntimeProtocol int `json:"runtime_update_protocol"`
		}
		if json.Unmarshal(h.Report, &report) != nil || report.Protocol < 2 || report.Protocol > 3 || imageTag.MatchString(reference) && report.Protocol != 3 {
			continue
		}
		if s.runtime != nil && s.runtimeCatalog != nil {
			release, err := s.runtimeCatalog.Current(h.Architecture)
			if err != nil || release.Validate(h.Architecture) != nil {
				lastErr = conflict("configuration_unavailable", "server runtime 发行资源尚未准备完成")
				continue
			}
			if report.RuntimeProtocol < release.Protocol() || report.RuntimeProtocol > 2 {
				continue
			}
		}
		if chosen == nil || h.EnvironmentCount*int64(chosen.MaxEnvironments) < chosen.EnvironmentCount*int64(h.MaxEnvironments) {
			chosen = h
			selected = placement{HostID: h.HostID, Architecture: h.Architecture, Image: reference, ImageDigest: digest, Resource: r}
		}
	}
	if chosen != nil {
		return selected, nil
	}
	if lastErr != nil {
		return selected, lastErr
	}
	if !authorized && len(candidates) > 0 {
		return selected, &failure{403, "host_access_denied", "没有可用宿主的新建权限"}
	}
	return selected, conflict("capacity_unavailable", "没有已授权且配置、环境数量满足要求的在线宿主")
}
