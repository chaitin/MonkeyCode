package lifecycle

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type State struct {
	Spec        Spec   `json:"spec"`
	Phase       Phase  `json:"phase"`
	ProviderRef string `json:"provider_ref,omitempty"`
	Reason      string `json:"reason,omitempty"`
}

type Store interface {
	Load(string) (State, error)
	Save(string, State) error
}

var ErrNotFound = errors.New("环境状态不存在")

type FileStore struct{ Root string }

func (s FileStore) path(id string) string { return filepath.Join(s.Root, id+".json") }

func validID(id string) bool { return identifier.MatchString(id) }

func validateState(id string, state State) error {
	if !validID(id) || id != state.Spec.EnvironmentID {
		return errors.New("状态与环境标识不一致")
	}
	if err := state.Spec.Validate(); err != nil {
		return err
	}
	switch state.Phase {
	case PhasePending, PhasePreparing, PhaseStarting, PhaseRunning, PhaseStopping, PhaseStopped, PhaseFailed, PhaseDeleting, PhaseDeleted:
	default:
		return errors.New("未知环境阶段")
	}
	return nil
}

func (s FileStore) Load(id string) (State, error) {
	if !validID(id) {
		return State{}, errors.New("环境标识无效")
	}
	info, err := os.Lstat(s.path(id))
	if errors.Is(err, os.ErrNotExist) {
		return State{}, ErrNotFound
	}
	if err != nil {
		return State{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return State{}, errors.New("状态文件类型或大小无效")
	}
	data, err := os.ReadFile(s.path(id))
	if err != nil {
		return State{}, fmt.Errorf("读取环境状态: %w", err)
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return State{}, fmt.Errorf("环境状态损坏: %w", err)
	}
	if err := validateState(id, state); err != nil {
		return State{}, fmt.Errorf("环境状态规格无效: %w", err)
	}
	return state, nil
}

func (s FileStore) Save(id string, state State) error {
	if !validID(id) {
		return errors.New("环境标识无效")
	}
	if err := validateState(id, state); err != nil {
		return err
	}
	if state.Phase == "" {
		return errors.New("环境阶段不能为空")
	}
	if err := os.MkdirAll(s.Root, 0o700); err != nil {
		return fmt.Errorf("创建状态目录: %w", err)
	}
	info, err := os.Lstat(s.Root)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("状态目录必须为独立受限目录")
	}
	data, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("编码环境状态: %w", err)
	}
	tmp, err := os.CreateTemp(s.Root, ".state-*")
	if err != nil {
		return fmt.Errorf("创建状态临时文件: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("设置状态文件权限: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("写入环境状态: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("同步环境状态: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("关闭环境状态: %w", err)
	}
	if err := os.Rename(tmpName, s.path(id)); err != nil {
		return fmt.Errorf("替换环境状态: %w", err)
	}
	dir, err := os.Open(s.Root)
	if err != nil {
		return fmt.Errorf("打开状态目录: %w", err)
	}
	defer dir.Close()
	return dir.Sync()
}

// Images 保护尚未完成清理的环境镜像，包括正在准备和启动失败的实例。
func (s FileStore) Images() (map[string]bool, error) {
	out := map[string]bool{}
	entries, err := os.ReadDir(s.Root)
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(s.Root)
	if err != nil || resolved != s.Root || len(entries) > 10000 {
		return nil, errors.New("环境状态目录不可安全核对")
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := entry.Name()[:len(entry.Name())-5]
		state, err := s.Load(id)
		if err != nil {
			return nil, err
		}
		if state.Phase != PhaseStopped && state.Phase != PhaseDeleted {
			out[state.Spec.Image] = true
		}
	}
	return out, nil
}
