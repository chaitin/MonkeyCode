package vmimage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

var ErrConversionCleanup = errors.New("隔离转换进程尚未确认回收，保留暂存目录和容量预留")

type sandboxAsset struct {
	Asset
	File string `json:"file"`
}
type SandboxRequest struct {
	Identity       Identity       `json:"identity"`
	Unpack         Tool           `json:"unpack"`
	Mkfs           Tool           `json:"mkfs"`
	Implementation string         `json:"implementation"`
	Assets         []sandboxAsset `json:"assets"`
	Limits         Limits         `json:"limits"`
}

func CurrentTool(ctx context.Context) (Tool, error) {
	binary, err := os.Executable()
	if err != nil {
		return Tool{}, err
	}
	binary, err = filepath.EvalSymlinks(binary)
	if err != nil {
		return Tool{}, err
	}
	f, err := os.Open(binary)
	if err != nil {
		return Tool{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() <= 0 || info.Size() > 512<<20 {
		return Tool{}, errors.New("转换程序自身文件无效")
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(contextReader{ctx, f}, info.Size()+1))
	if err != nil || n != info.Size() {
		return Tool{}, errors.New("读取转换程序自身失败")
	}
	sum := "sha256:" + hex.EncodeToString(hash.Sum(nil))
	tool := Tool{Path: binary, Digest: sum}
	return tool, tool.Verify(ctx)
}

// BuildIsolated 在没有任何宿主凭据、用户盘或外网的受限chroot服务中解包及格式化。
func (c *Converter) BuildIsolated(layout string, engine Tool) Build {
	return func(ctx context.Context, id Identity, stage string) error {
		if engine.Digest != c.ImplementationDigest {
			return errors.New("转换程序摘要与模板身份不符")
		}
		if err := engine.Verify(ctx); err != nil {
			return err
		}
		if _, err := InspectLayout(ctx, layout, id.ImageDigest, id.Architecture, c.Limits.Bytes); err != nil {
			return err
		}
		root := filepath.Join(stage, "sandbox")
		for _, name := range []string{"", "bin", "assets", "oci", "oci/blobs", "oci/blobs/sha256", "output", "tmp", "proc", "sys", "dev"} {
			directory := filepath.Join(root, name)
			if err := os.MkdirAll(directory, 0755); err != nil {
				return err
			}
			// daemon使用UMask=0077；动态用户须能在exec之前进入隔离根目录。
			if err := os.Chmod(directory, 0755); err != nil {
				return err
			}
		}
		request := SandboxRequest{Identity: id, Unpack: Tool{Path: "/bin/umoci", Digest: c.Unpack.Digest}, Mkfs: Tool{Path: "/bin/mke2fs", Digest: c.Mkfs.Digest}, Implementation: engine.Digest, Limits: c.Limits}
		for _, item := range []struct {
			tool Tool
			name string
		}{{engine, "engine"}, {c.Unpack, "umoci"}, {c.Mkfs, "mke2fs"}} {
			if err := item.tool.Verify(ctx); err != nil {
				return err
			}
			if err := copyExecutable(ctx, item.tool.Path, filepath.Join(root, "bin", item.name)); err != nil {
				return err
			}
		}
		entries, err := os.ReadDir(filepath.Join(layout, "blobs", "sha256"))
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Join(root, "oci", "blobs", "sha256"), 0755); err != nil {
			return err
		}
		for _, entry := range entries {
			if !digestPattern.MatchString("sha256:" + entry.Name()) {
				return errors.New("OCI输入包含未知blob文件名")
			}
			if err := copyInput(ctx, filepath.Join(layout, "blobs", "sha256", entry.Name()), filepath.Join(root, "oci", "blobs", "sha256", entry.Name())); err != nil {
				return err
			}
		}
		if err := copyInput(ctx, filepath.Join(layout, "oci-layout"), filepath.Join(root, "oci", "oci-layout")); err != nil {
			return err
		}
		for index, asset := range c.Assets {
			name := fmt.Sprintf("asset-%d", index)
			if err := copyInput(ctx, asset.Source, filepath.Join(root, "assets", name)); err != nil {
				return err
			}
			request.Assets = append(request.Assets, sandboxAsset{Asset: asset, File: "/assets/" + name})
		}
		raw, err := json.Marshal(request)
		if err != nil {
			return err
		}
		if len(raw) > 64<<10 {
			return errors.New("转换请求过大")
		}
		if err := os.WriteFile(filepath.Join(root, "request.json"), raw, 0600); err != nil {
			return err
		}
		var nonce [12]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			return err
		}
		unit := "ma-cvt-" + hex.EncodeToString(nonce[:]) + ".service"
		job, cancel := context.WithTimeout(ctx, 16*time.Minute)
		if err := saveConversionJob(stage, unit); err != nil {
			cancel()
			return err
		}
		defer cancel()
		uid, runErr := reserveConversionIdentity(job, stage, unit)
		if runErr == nil {
			command := exec.CommandContext(job, "systemd-run", sandboxArgs(unit, root, uid)...)
			command.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
			runErr = command.Run()
		}
		cleanup, stop := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer stop()
		stopErr := exec.CommandContext(cleanup, "systemctl", "stop", unit).Run()
		state, stateErr := exec.CommandContext(cleanup, "systemctl", "show", unit, "--property=LoadState,ActiveState,MainPID,ControlGroup").Output()
		if stateErr != nil {
			return errors.Join(ErrConversionCleanup, runErr, stopErr, stateErr)
		}
		if err := verifyConversionState(unit, string(state)); err != nil {
			return errors.Join(ErrConversionCleanup, runErr, stopErr, err)
		}
		if err := releaseConversionIdentity(cleanup, identityUnit(unit)); err != nil {
			return errors.Join(ErrConversionCleanup, runErr, err)
		}
		if runErr != nil {
			return fmt.Errorf("隔离转换失败（服务%s）: %w", unit, runErr)
		}
		if err := os.Rename(filepath.Join(root, "output", "root.ext4"), filepath.Join(stage, "root.ext4")); err != nil {
			return err
		}
		if err := os.RemoveAll(root); err != nil {
			return err
		}
		return errors.Join(os.Remove(filepath.Join(stage, "job.json")), os.Remove(filepath.Join(stage, "identity.uid")))
	}
}

// ConvertRequest 仅由隔离服务调用，不加载生产配置或创建控制面身份。
func ConvertRequest(ctx context.Context, path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return errors.New("转换请求文件无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var request SandboxRequest
	if json.Unmarshal(raw, &request) != nil {
		return errors.New("转换请求损坏")
	}
	if request.Unpack.Path != "/bin/umoci" || request.Mkfs.Path != "/bin/mke2fs" || !digestPattern.MatchString(request.Implementation) {
		return errors.New("转换请求工具路径无效")
	}
	converter := Converter{Unpack: request.Unpack, Mkfs: request.Mkfs, ImplementationDigest: request.Implementation, Limits: request.Limits}
	for _, wire := range request.Assets {
		if !filepath.IsAbs(wire.File) || filepath.Dir(wire.File) != "/assets" {
			return errors.New("转换组件不在隔离输入目录")
		}
		asset := wire.Asset
		asset.Source = wire.File
		converter.Assets = append(converter.Assets, asset)
	}
	return converter.Build("/oci")(ctx, request.Identity, "/output")
}
func sandboxArgs(unit, root string, uid uint32) []string {
	caps := "CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER CAP_FSETID CAP_SETFCAP CAP_SETUID CAP_SETGID"
	return []string{
		"--wait", "--quiet", "--unit=" + unit, "--service-type=exec",
		"--property=RootDirectory=" + root, "--property=WorkingDirectory=/", "--property=MountAPIVFS=yes",
		"--property=DynamicUser=no", "--property=User=0", "--property=Group=0",
		"--property=PrivateTmp=yes", "--property=RemoveIPC=yes",
		"--property=PrivateNetwork=yes", "--property=PrivateDevices=yes",
		"--property=ProtectSystem=strict", "--property=ReadWritePaths=+/output +/tmp",
		// 恢复虚拟机文件的SUID/SGID元数据，但禁止在宿主执行解包内容。
		"--property=RestrictSUIDSGID=no", "--property=NoExecPaths=+/output +/tmp +/oci +/assets",
		"--property=ProtectHome=yes", "--property=ProtectProc=invisible", "--property=ProcSubset=pid",
		"--property=NoNewPrivileges=yes", "--property=CapabilityBoundingSet=" + caps, "--property=AmbientCapabilities=" + caps,
		"--property=RestrictAddressFamilies=AF_UNIX", "--property=MemoryMax=1G", "--property=MemorySwapMax=0",
		"--property=CPUQuota=200%", "--property=TasksMax=128", "--property=RuntimeMaxSec=900s",
		"--property=TimeoutStopSec=10s", "--property=KillMode=control-group",
		"--property=StandardOutput=null", "--property=StandardError=journal",
		"--", "/bin/engine", "convert-launch", "--uid", strconv.FormatUint(uint64(uid), 10),
	}
}

func copyExecutable(ctx context.Context, source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, contextReader{ctx, in})
	// 工具必须是独立副本；不能chmod硬链接而改动已安装程序。
	return errors.Join(copyErr, out.Chmod(0555), out.Sync(), out.Close())
}

func copyInput(ctx context.Context, source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("隔离转换输入必须是普通文件")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// 输入不会在子进程中写入；同文件系统链接可避免大镜像的重复物理复制。
	if err := os.Link(source, destination); err == nil {
		return nil
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, contextReader{ctx, in})
	return errors.Join(copyErr, out.Sync(), out.Close())
}
