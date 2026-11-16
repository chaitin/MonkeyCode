package firecracker

import (
	"context"
	"errors"
)

func (m *Manager) Destroy(ctx context.Context, id string, confirmed bool) (State, error) {
	if !confirmed {
		return State{}, errors.New("永久销毁需要独立明确确认")
	}
	unlock, err := m.lock(id)
	if err != nil {
		return State{}, err
	}
	defer unlock()
	state, err := m.load(id)
	if err != nil {
		return state, err
	}
	if state.Phase == "destroyed" {
		return state, nil
	}
	if state.Phase != "retained" || state.Lease != "" {
		return state, errors.New("永久销毁仅允许已删除且保留、没有写入者的双盘")
	}
	running, err := m.host.Running(ctx, state.ID)
	if err != nil {
		return state, err
	}
	if running {
		return state, errors.New("宿主虚拟机仍存在，拒绝销毁")
	}
	if err := m.host.Remove(ctx, state.ID); err != nil {
		return state, err
	}
	if err := m.disks.Destroy(id, state.Spec.Disks.InstanceID, true); err != nil {
		return state, err
	}
	state.Phase = "destroyed"
	return state, m.save(state)
}
