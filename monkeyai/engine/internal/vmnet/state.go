package vmnet

// HasAllocation 用于失败清理确认；不把没有VMM记录等同于没有网络残留。
func (m *Manager) HasAllocation(id string) (bool, error) {
	all, err := m.load()
	if err != nil {
		return false, err
	}
	_, ok := all[id]
	return ok, nil
}
