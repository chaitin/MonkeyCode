package vmimage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
)

type Asset struct {
	Target string `json:"target"`
	Digest string `json:"digest"`
	Mode   uint32 `json:"mode"`
	Source string `json:"-"`
}

type Limits struct {
	Bytes   int64
	Files   int64
	Timeout time.Duration
}

// Converter 仅消费已拉取的本地 OCI 布局。调用方负责在受限离线进程中执行。
// 解包复用固定版本 umoci，避免自行实现 whiteout、所有权和扩展属性规则。
type Converter struct {
	Unpack   Tool
	Mkfs     Tool
	Assets   []Asset
	Limits   Limits
	run      func(context.Context, Tool, ...string) error
	populate func(context.Context, string, int64, string) error
}

func (c *Converter) Identity() (converter, bootstrap string, err error) {
	if !digestPattern.MatchString(c.Unpack.Digest) || !digestPattern.MatchString(c.Mkfs.Digest) {
		return "", "", errors.New("转换工具缺少固定摘要")
	}
	raw, _ := json.Marshal([]string{"monkeyai-oci-ext4-v1", c.Unpack.Digest, c.Mkfs.Digest})
	converter = digestBytes(raw)
	assets := append([]Asset(nil), c.Assets...)
	sort.Slice(assets, func(i, j int) bool { return assets[i].Target < assets[j].Target })
	seen := map[string]bool{}
	for _, a := range assets {
		if !validTarget(a.Target) || seen[a.Target] || !digestPattern.MatchString(a.Digest) || a.Mode == 0 || a.Mode&^0777 != 0 {
			return "", "", errors.New("启动组件路径、摘要或权限无效")
		}
		seen[a.Target] = true
	}
	if len(assets) == 0 {
		return "", "", errors.New("缺少启动组件")
	}
	raw, _ = json.Marshal(assets)
	return converter, digestBytes(raw), nil
}

func validTarget(target string) bool {
	return target != "" && path.Clean(target) == target && !strings.HasPrefix(target, "/") && target != ".." && !strings.HasPrefix(target, "../") && !strings.ContainsAny(target, "\x00\r\n\\")
}
func digestBytes(data []byte) string {
	h := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(h[:])
}

func (c *Converter) Build(layout string) Build {
	return func(ctx context.Context, id Identity, stage string) error {
		converter, bootstrap, err := c.Identity()
		if err != nil {
			return err
		}
		if err := id.Validate(); err != nil {
			return err
		}
		if id.ConverterDigest != converter || id.BootstrapDigest != bootstrap {
			return errors.New("转换器或启动组件与模板身份不匹配")
		}
		if c.Limits.Bytes <= 0 || c.Limits.Bytes > 16<<40 || c.Limits.Files <= 0 || c.Limits.Files > 10000000 || c.Limits.Timeout <= 0 || c.Limits.Timeout > 30*time.Minute {
			return errors.New("必须配置有界的转换空间、文件数及超时")
		}
		ctx, cancel := context.WithTimeout(ctx, c.Limits.Timeout)
		defer cancel()
		resolved, err := filepath.EvalSymlinks(stage)
		if err != nil || !filepath.IsAbs(stage) || resolved != stage {
			return errors.New("转换暂存目录无效")
		}
		image, err := InspectLayout(ctx, layout, id.ImageDigest, id.Architecture, c.Limits.Bytes)
		if err != nil {
			return err
		}
		// 缓存身份绑定架构 manifest，防止多架构索引在不同机器产生含糊缓存。
		if image.Manifest.Digest != id.ImageDigest {
			return errors.New("转换输入必须固定为所选架构的 manifest 摘要")
		}
		if err := c.Unpack.Verify(ctx); err != nil {
			return err
		}
		if err := c.Mkfs.Verify(ctx); err != nil {
			return err
		}
		input := filepath.Join(stage, "input")
		if err := os.MkdirAll(filepath.Join(input, "blobs", "sha256"), 0700); err != nil {
			return err
		}
		source, err := os.OpenRoot(layout)
		if err != nil {
			return err
		}
		defer source.Close()
		descriptors := append([]Descriptor{image.Manifest, image.Config}, image.Layers...)
		copied := map[string]bool{}
		var copiedBytes int64
		for _, d := range descriptors {
			if copied[d.Digest] {
				continue
			}
			copied[d.Digest] = true
			if d.Size <= 0 || d.Size > c.Limits.Bytes-copiedBytes {
				return errors.New("私有镜像副本超过物理准备预算")
			}
			copiedBytes += d.Size
			if err := copyBlob(ctx, source, d, input); err != nil {
				return err
			}
		}
		if err := os.WriteFile(filepath.Join(input, "oci-layout"), []byte(`{"imageLayoutVersion":"1.0.0"}`), 0600); err != nil {
			return err
		}
		// 仅修改私有布局，不污染共享下载缓存的标签或索引。
		entry := struct {
			Descriptor
			Annotations map[string]string `json:"annotations"`
		}{image.Manifest, map[string]string{"org.opencontainers.image.ref.name": "root"}}
		index := struct {
			Version   int   `json:"schemaVersion"`
			Manifests []any `json:"manifests"`
		}{2, []any{entry}}
		raw, _ := json.Marshal(index)
		if err := os.WriteFile(filepath.Join(input, "index.json"), raw, 0600); err != nil {
			return err
		}
		bundle := filepath.Join(stage, "bundle")
		runner := c.run
		if runner == nil {
			runner = func(ctx context.Context, t Tool, args ...string) error { return t.Run(ctx, args...) }
		}
		if err := runner(ctx, c.Unpack, "unpack", "--image", input+":root", bundle); err != nil {
			return err
		}
		rootfs := filepath.Join(bundle, "rootfs")
		if err := c.checkTree(ctx, rootfs); err != nil {
			return err
		}
		root, err := os.OpenRoot(rootfs)
		if err != nil {
			return err
		}
		defer root.Close()
		for _, a := range c.Assets {
			if err := inject(ctx, root, a, c.Limits.Bytes); err != nil {
				return err
			}
		}
		// 不把 OCI 的 Docker 启动语义或任何用户运行身份自动带入虚拟机。
		for _, name := range []string{"etc/machine-id", "var/lib/dbus/machine-id"} {
			if err := root.Remove(name); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
		if err := c.checkTree(ctx, rootfs); err != nil {
			return err
		}
		populate := c.populate
		if populate == nil {
			ext, err := vmdisk.NewExt4(c.Mkfs.Path)
			if err != nil {
				return err
			}
			populate = ext.Populate
		}
		if err := c.Mkfs.Verify(ctx); err != nil {
			return err
		}
		if err := populate(ctx, filepath.Join(stage, "root.ext4"), id.SystemBytes, rootfs); err != nil {
			return err
		}
		// ready 缓存只保留最终模板，不保留解包树和临时 OCI 副本。
		if err := os.RemoveAll(bundle); err != nil {
			return err
		}
		return os.RemoveAll(input)
	}
}

func copyBlob(ctx context.Context, root *os.Root, d Descriptor, destination string) (err error) {
	in, err := openBlob(root, d, d.Size)
	if err != nil {
		return err
	}
	defer in.Close()
	name, err := blobPath(d)
	if err != nil {
		return err
	}
	out, err := os.OpenFile(filepath.Join(destination, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, out.Close()) }()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(contextReader{ctx, in}, d.Size+1))
	if err != nil {
		return err
	}
	if n != d.Size || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != d.Digest {
		return errors.New("复制镜像时摘要或大小发生变化")
	}
	return out.Sync()
}

func inject(ctx context.Context, root *os.Root, a Asset, limit int64) error {
	info, err := os.Lstat(a.Source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > limit {
		return errors.New("启动组件源文件无效")
	}
	in, err := os.Open(a.Source)
	if err != nil {
		return err
	}
	defer in.Close()
	opened, err := in.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return errors.New("启动组件被替换")
	}
	// 平台组件的父路径不能由镜像中的符号链接重定向。
	current := ""
	for _, part := range strings.Split(path.Dir(a.Target), "/") {
		if part == "." {
			continue
		}
		current = path.Join(current, part)
		st, err := root.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			if err := root.Mkdir(current, 0755); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if !st.IsDir() {
			return fmt.Errorf("启动组件父路径非目录: %s", current)
		}
	}
	if old, err := root.Lstat(a.Target); err == nil {
		if old.IsDir() {
			return errors.New("不能覆盖启动组件位置的目录")
		}
		if err := root.Remove(a.Target); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	out, err := root.OpenFile(a.Target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, os.FileMode(a.Mode))
	if err != nil {
		return err
	}
	hash := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(out, hash), io.LimitReader(contextReader{ctx, in}, info.Size()+1))
	if copyErr == nil && (n != info.Size() || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != a.Digest) {
		copyErr = errors.New("启动组件摘要不匹配")
	}
	if copyErr == nil {
		copyErr = out.Chmod(os.FileMode(a.Mode))
	}
	if copyErr == nil {
		copyErr = out.Sync()
	}
	return errors.Join(copyErr, out.Close())
}

func (c *Converter) checkTree(ctx context.Context, root string) error {
	info, err := os.Lstat(root)
	if err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root || !info.IsDir() {
		return errors.New("解包输出必须为真实目录")
	}
	var files, bytes int64
	return filepath.WalkDir(root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		files++
		if files > c.Limits.Files {
			return errors.New("镜像解包文件数超过上限")
		}
		if entry.Type()&(os.ModeDevice|os.ModeNamedPipe|os.ModeSocket) != 0 {
			return errors.New("镜像不允许包含宿主设备、管道或套接字")
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			if info.Size() < 0 || info.Size() > c.Limits.Bytes-bytes {
				return errors.New("镜像解包文件总量超过上限")
			}
			bytes += info.Size()
		}
		return nil
	})
}
