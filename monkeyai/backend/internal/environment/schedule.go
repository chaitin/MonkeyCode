package environment

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

// 调度状态与创建在同一事务内提交，控制锁保证多实例共享同一轮询序列。
func (s *Service) schedule(ctx context.Context, q *sqlc.Queries, profile Profile) (string, error) {
	candidates, err := q.AvailableHosts(ctx, sqlc.AvailableHostsParams{Architecture: profile.Architecture, NetworkPolicy: profile.NetworkPolicy, RuntimeRequired: s.runtime != nil})
	if err != nil {
		return "", err
	}
	previous, err := q.SchedulingWeights(ctx)
	if err != nil {
		return "", err
	}
	weights := make(map[string]sqlc.EnvironmentScheduling, len(previous))
	for _, state := range previous {
		weights[state.HostID] = state
	}
	var eligible []sqlc.EnvironmentScheduling
	var ids []string
	var total int64
	changed := false
	for _, host := range candidates {
		usage, err := q.HostUsage(ctx, host.HostID)
		if err != nil {
			return "", err
		}
		capacity := reportedCapacity(host.Report)
		host.CpuMillis, host.MemoryBytes = capacity.CPUMillis, capacity.MemoryBytes
		if host.CpuMillis <= 0 ||
			!fits(host.CpuMillis, usage.CpuMillis, profile.Resource.CPUMillis) ||
			!fits(host.MemoryBytes, usage.MemoryBytes, profile.Resource.MemoryBytes) {
			continue
		}
		state, ok := weights[host.HostID]
		if !ok || state.Weight != host.CpuMillis {
			changed = true
		}
		state.HostID, state.Weight = host.HostID, host.CpuMillis
		eligible = append(eligible, state)
		ids = append(ids, host.HostID)
		total += host.CpuMillis
	}
	if len(eligible) == 0 {
		return "", conflict("capacity_unavailable", "没有在线且容量充足的已启用宿主")
	}
	// 可用集合或权重变化后开启新一轮，不让离线宿主积累补偿请求。
	changed = changed || len(eligible) != len(previous)
	selected := 0
	for i := range eligible {
		if changed {
			eligible[i].CurrentWeight = 0
		}
		eligible[i].CurrentWeight += eligible[i].Weight
		if eligible[i].CurrentWeight > eligible[selected].CurrentWeight {
			selected = i
		}
	}
	eligible[selected].CurrentWeight -= total
	if err := q.ClearSchedulingWeights(ctx, ids); err != nil {
		return "", err
	}
	for _, state := range eligible {
		if err := q.SetSchedulingWeight(ctx, sqlc.SetSchedulingWeightParams{HostID: state.HostID, Weight: state.Weight, CurrentWeight: state.CurrentWeight}); err != nil {
			return "", err
		}
	}
	return eligible[selected].HostID, nil
}
