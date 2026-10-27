package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"uuid"
)

type serverIdentity struct {
	ServerID   string `json:"server_id"`
	PrivateKey string `json:"private_key"`
}

func resolveIdentity(config *Config) (ed25519.PrivateKey, error) {
	if config.ServerID == "" || config.SigningKeyFile == "" {
		state, err := loadIdentity(config.StateDir)
		if err != nil {
			return nil, err
		}
		if config.ServerID == "" {
			config.ServerID = state.ServerID
		}
		if config.SigningKeyFile == "" {
			return parseSigningKey([]byte(state.PrivateKey))
		}
	}
	return loadSigningKey(config.SigningKeyFile)
}

func loadIdentity(dir string) (serverIdentity, error) {
	if dir == "" {
		dir = "data/runtime"
	}
	path := filepath.Join(dir, "identity.json")
	if state, err := readIdentity(path); !errors.Is(err, os.ErrNotExist) {
		return state, err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return serverIdentity{}, fmt.Errorf("创建远程执行状态目录 %q（MONKEYAI_RUNTIME_STATE_DIR）: %w", dir, err)
	}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return serverIdentity{}, err
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return serverIdentity{}, err
	}
	state := serverIdentity{ServerID: uuid.New().String(), PrivateKey: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))}
	data, err := json.Marshal(state)
	if err != nil {
		return serverIdentity{}, err
	}
	temp, err := os.CreateTemp(dir, ".identity-*")
	if err != nil {
		return serverIdentity{}, fmt.Errorf("创建远程执行身份文件: %w", err)
	}
	defer func() {
		if err := os.Remove(temp.Name()); err != nil && !os.IsNotExist(err) {
			slog.Error("清理临时文件失败", "module", "relay", "operation", "loadIdentity", "error", err)
		}
	}()
	defer func() {
		if err := temp.Close(); err != nil && !errors.Is(err, os.ErrClosed) {
			slog.Error("关闭资源失败", "module", "relay", "operation", "loadIdentity", "error", err)
		}
	}()
	if _, err = temp.Write(data); err != nil {
		return serverIdentity{}, err
	}
	if err = temp.Sync(); err != nil {
		return serverIdentity{}, err
	}
	if err = temp.Close(); err != nil {
		return serverIdentity{}, err
	}
	// 发布完整身份文件且不覆盖并发启动已经保存的身份。
	if err = os.Link(temp.Name(), path); err != nil && !errors.Is(err, os.ErrExist) {
		return serverIdentity{}, fmt.Errorf("保存远程执行身份: %w", err)
	}
	if runtime.GOOS != "windows" {
		directory, err := os.Open(dir)
		if err != nil {
			return serverIdentity{}, err
		}
		err = directory.Sync()
		if err := directory.Close(); err != nil {
			slog.Error("关闭资源失败", "module", "relay", "operation", "loadIdentity", "error", err)
		}
		if err != nil {
			return serverIdentity{}, err
		}
	}
	return readIdentity(path)
}

func readIdentity(path string) (serverIdentity, error) {
	file, err := os.Open(path)
	if err != nil {
		return serverIdentity{}, err
	}
	defer func() {
		if err := file.Close(); err != nil {
			slog.Error("关闭资源失败", "module", "relay", "operation", "readIdentity", "error", err)
		}
	}()
	info, err := file.Stat()
	if err != nil {
		return serverIdentity{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<10 || runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0 {
		return serverIdentity{}, errors.New("远程执行身份文件必须为仅服务账号可读写的普通文件")
	}
	var state serverIdentity
	decoder := json.NewDecoder(io.LimitReader(file, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&state); err != nil || !validUUID(state.ServerID) {
		if err != nil {
			slog.Warn("操作失败", "module", "relay", "operation", "readIdentity", "error", err)
		}
		return serverIdentity{}, errors.New("远程执行身份文件无效，拒绝覆盖已有身份")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return serverIdentity{}, errors.New("远程执行身份文件含多余内容，拒绝覆盖已有身份")
	}
	if _, err := parseSigningKey([]byte(state.PrivateKey)); err != nil {
		slog.Warn("操作失败", "module", "relay", "operation", "readIdentity", "error", err)
		return serverIdentity{}, errors.New("远程执行身份私钥无效，拒绝覆盖已有身份")
	}
	return state, nil
}
