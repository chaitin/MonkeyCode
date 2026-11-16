package lifecycle

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func (s FileStore) List() ([]State, error) {
	entries, err := os.ReadDir(s.Root)
	if errors.Is(err, os.ErrNotExist) {
		return []State{}, nil
	}
	if err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(s.Root)
	if err != nil || resolved != s.Root || len(entries) > 10000 {
		return nil, errors.New("环境状态目录不可安全核对")
	}
	states := make([]State, 0, len(entries))
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		state, err := s.Load(strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil {
			return nil, err
		}
		states = append(states, state)
	}
	return states, nil
}
