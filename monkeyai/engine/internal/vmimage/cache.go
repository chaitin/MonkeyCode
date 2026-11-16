package vmimage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type Identity struct {
	Architecture    string `json:"architecture"`
	ImageDigest     string `json:"image_digest"`
	ConverterDigest string `json:"converter_digest"`
	KernelDigest    string `json:"kernel_digest"`
	BootstrapDigest string `json:"bootstrap_digest"`
	SystemBytes     int64  `json:"system_bytes"`
}

func (i Identity) Validate() error {
	if i.Architecture != "amd64" && i.Architecture != "arm64" {
		return errors.New("不支持的镜像架构")
	}
	for _, d := range []string{i.ImageDigest, i.ConverterDigest, i.KernelDigest, i.BootstrapDigest} {
		if !digestPattern.MatchString(d) {
			return errors.New("镜像及转换组件必须使用固定 sha256 摘要")
		}
	}
	if i.SystemBytes < 64<<20 || i.SystemBytes > 16<<40 || i.SystemBytes%4096 != 0 {
		return errors.New("系统盘容量无效")
	}
	return nil
}

func (i Identity) Key() (string, error) {
	if err := i.Validate(); err != nil {
		return "", err
	}
	data, _ := json.Marshal(i)
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:]), nil
}

type Template struct {
	Identity Identity `json:"identity"`
	SHA256   string   `json:"sha256"`
	Path     string   `json:"-"`
}

// Build 只向 staging 中写入 root.ext4；发布由缓存统一完成。
type Build func(ctx context.Context, identity Identity, staging string) error

type Cache struct{ root string }

func New(root string) (*Cache, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == string(filepath.Separator) {
		return nil, errors.New("缓存目录必须是非根目录的规范绝对路径")
	}
	for _, p := range []string{root, filepath.Join(root, "templates"), filepath.Join(root, "locks")} {
		if err := storage.PrivateDir(p); err != nil {
			return nil, err
		}
	}
	return &Cache{root: root}, nil
}

func (c *Cache) Ensure(ctx context.Context, identity Identity, build Build) (Template, error) {
	if err := identity.Validate(); err != nil {
		return Template{}, err
	}
	if err := ctx.Err(); err != nil {
		return Template{}, err
	}
	key, err := identity.Key()
	if err != nil {
		return Template{}, err
	}
	unlock, err := control.Lock(filepath.Join(c.root, "locks", key+".lock"))
	if err != nil {
		return Template{}, err
	}
	defer unlock()
	dir := filepath.Join(c.root, "templates", key)
	if _, err := os.Lstat(dir); err == nil {
		return c.load(ctx, dir, identity)
	} else if !errors.Is(err, os.ErrNotExist) {
		return Template{}, err
	}
	if build == nil {
		return Template{}, errors.New("缺少镜像转换器")
	}
	pending, err := os.ReadDir(filepath.Join(c.root, "templates"))
	if err != nil {
		return Template{}, err
	}
	for _, entry := range pending {
		if strings.HasPrefix(entry.Name(), ".convert-"+key+"-") {
			if err := recoverConversion(ctx, filepath.Join(c.root, "templates", entry.Name())); err != nil {
				return Template{}, fmt.Errorf("恢复中断转换: %w", err)
			}
		}
	}
	stage, err := os.MkdirTemp(filepath.Join(c.root, "templates"), ".convert-"+key+"-")
	if err != nil {
		return Template{}, err
	}
	clean := true
	defer func() {
		if clean {
			os.RemoveAll(stage)
		}
	}()
	if err := build(ctx, identity, stage); err != nil {
		if errors.Is(err, ErrConversionCleanup) {
			clean = false
		}
		return Template{}, fmt.Errorf("转换镜像: %w", err)
	}
	path := filepath.Join(stage, "root.ext4")
	sum, err := hashDisk(ctx, path, identity.SystemBytes)
	if err != nil {
		return Template{}, err
	}
	if err := os.Chmod(path, 0400); err != nil {
		return Template{}, err
	}
	t := Template{Identity: identity, SHA256: sum}
	data, err := json.Marshal(t)
	if err != nil {
		return Template{}, err
	}
	if err := control.Write(filepath.Join(stage, "manifest.json"), data, 0600); err != nil {
		return Template{}, err
	}
	if err := syncFile(path); err != nil {
		return Template{}, err
	}
	if err := syncFile(stage); err != nil {
		return Template{}, err
	}
	if err := ctx.Err(); err != nil {
		return Template{}, err
	}
	if err := os.Rename(stage, dir); err != nil {
		return Template{}, err
	}
	if err := syncFile(filepath.Dir(dir)); err != nil {
		return Template{}, err
	}
	return c.load(ctx, dir, identity)
}

func (c *Cache) load(ctx context.Context, dir string, identity Identity) (Template, error) {
	info, err := os.Lstat(dir)
	if err != nil {
		return Template{}, err
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil || !info.IsDir() || resolved != dir || info.Mode().Perm()&0077 != 0 {
		return Template{}, errors.New("镜像缓存目录不安全")
	}
	path := filepath.Join(dir, "manifest.json")
	info, err = os.Lstat(path)
	if err != nil {
		return Template{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 8192 || info.Mode().Perm()&0077 != 0 {
		return Template{}, errors.New("镜像缓存清单无效")
	}
	f, err := os.Open(path)
	if err != nil {
		return Template{}, err
	}
	defer f.Close()
	var t Template
	dec := json.NewDecoder(io.LimitReader(f, 8193))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&t); err != nil {
		return Template{}, err
	}
	if err := dec.Decode(new(any)); !errors.Is(err, io.EOF) {
		return Template{}, errors.New("缓存清单含多余内容")
	}
	if t.Identity != identity || !digestPattern.MatchString(t.SHA256) {
		return Template{}, errors.New("缓存身份不匹配")
	}
	t.Path = filepath.Join(dir, "root.ext4")
	sum, err := hashDisk(ctx, t.Path, identity.SystemBytes)
	if err != nil {
		return Template{}, err
	}
	info, err = os.Lstat(t.Path)
	if err != nil || info.Mode().Perm()&0222 != 0 {
		return Template{}, errors.New("镜像模板必须只读")
	}
	if sum != t.SHA256 {
		return Template{}, errors.New("镜像模板摘要不匹配，拒绝自动覆盖")
	}
	return t, nil
}

func hashDisk(ctx context.Context, path string, size int64) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() != size || info.Mode().Perm()&0077 != 0 {
		return "", errors.New("镜像模板类型、容量或权限无效")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return "", errors.New("读取模板时文件发生替换")
	}
	h := sha256.New()
	buf := make([]byte, 1<<20)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, err := f.Read(buf)
		if n > 0 {
			_, _ = h.Write(buf[:n])
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}

func syncFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}
