package driver

import (
	"archive/tar"
	"context"
	"encoding/json"
	"errors"
	"io"
	"runtime"
	"sync"

	containerd "github.com/containerd/containerd/v2/client"
	"github.com/containerd/containerd/v2/core/content"
	"github.com/containerd/containerd/v2/core/images"
	"github.com/containerd/containerd/v2/pkg/archive/compression"
	"github.com/containerd/platforms"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
)

const maxCompressed = int64(4 << 30)
const maxExpanded = int64(16 << 30)

func pullLimit() images.HandlerFunc {
	var mu sync.Mutex
	var total int64
	seen := map[string]bool{}
	return func(_ context.Context, d ocispec.Descriptor) ([]ocispec.Descriptor, error) {
		mu.Lock()
		defer mu.Unlock()
		if seen[d.Digest.String()] {
			return nil, nil
		}
		seen[d.Digest.String()] = true
		if d.Size <= 0 || d.Size > 1<<30 || total+d.Size > maxCompressed || len(seen) > 256 {
			return nil, errors.New("镜像压缩体积、层数或元数据超过限制")
		}
		total += d.Size
		return nil, nil
	}
}
func imageConfig(ctx context.Context, client *containerd.Client, image containerd.Image) (ocispec.Image, error) {
	var cfg ocispec.Image
	desc, err := image.Config(ctx)
	if err != nil {
		return cfg, err
	}
	if desc.Size <= 0 || desc.Size > 4<<20 {
		return cfg, errors.New("镜像配置过大")
	}
	raw, err := content.ReadBlob(ctx, client.ContentStore(), desc)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return cfg, err
	}
	if cfg.OS != "linux" || cfg.Architecture != runtime.GOARCH {
		return cfg, errors.New("镜像平台与宿主不一致，禁止架构模拟")
	}
	if len(cfg.Config.Entrypoint)+len(cfg.Config.Cmd) == 0 {
		return cfg, errors.New("镜像没有启动命令")
	}
	return cfg, nil
}
func checkLayers(ctx context.Context, client *containerd.Client, image containerd.Image) error {
	manifest, err := images.Manifest(ctx, client.ContentStore(), image.Target(), platforms.DefaultStrict())
	if err != nil {
		return err
	}
	if len(manifest.Layers) == 0 || len(manifest.Layers) > 128 {
		return errors.New("镜像层数无效")
	}
	remaining := maxExpanded
	files := 0
	for _, layer := range manifest.Layers {
		if err := ctx.Err(); err != nil {
			return err
		}
		reader, err := client.ContentStore().ReaderAt(ctx, layer)
		if err != nil {
			return err
		}
		stream, err := compression.DecompressStream(io.NewSectionReader(reader, 0, reader.Size()))
		if err != nil {
			reader.Close()
			return err
		}
		err = scanLayer(ctx, stream, &remaining, &files)
		stream.Close()
		reader.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
func scanLayer(ctx context.Context, stream io.Reader, remaining *int64, files *int) error {
	limited := &io.LimitedReader{R: stream, N: *remaining + 1}
	tarReader := tar.NewReader(limited)
	var logical int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		*files++
		logical += header.Size
		if header.Size < 0 || logical > *remaining || *files > 1000000 {
			return errors.New("镜像解包体积或文件数超过限制")
		}
	}
	if _, err := io.Copy(io.Discard, limited); err != nil {
		return err
	}
	consumed := *remaining + 1 - limited.N
	if consumed > *remaining {
		return errors.New("镜像解压数据超过限制")
	}
	*remaining -= max(consumed, logical)
	return nil
}
