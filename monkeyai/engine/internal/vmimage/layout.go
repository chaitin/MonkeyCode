package vmimage

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	ociManifest          = "application/vnd.oci.image.manifest.v1+json"
	ociIndex             = "application/vnd.oci.image.index.v1+json"
	dockerManifest       = "application/vnd.docker.distribution.manifest.v2+json"
	dockerIndex          = "application/vnd.docker.distribution.manifest.list.v2+json"
	metadataLimit  int64 = 4 << 20
)

type Descriptor struct {
	MediaType string    `json:"mediaType"`
	Digest    string    `json:"digest"`
	Size      int64     `json:"size"`
	URLs      []string  `json:"urls,omitempty"`
	Platform  *Platform `json:"platform,omitempty"`
}

type Platform struct {
	Architecture string `json:"architecture"`
	OS           string `json:"os"`
	Variant      string `json:"variant,omitempty"`
}

type Image struct {
	Manifest Descriptor
	Config   Descriptor
	Layers   []Descriptor
	DiffIDs  []string
}

type imageManifest struct {
	SchemaVersion int          `json:"schemaVersion"`
	MediaType     string       `json:"mediaType"`
	Config        Descriptor   `json:"config,omitzero"`
	Layers        []Descriptor `json:"layers,omitempty"`
	Manifests     []Descriptor `json:"manifests,omitempty"`
}

// InspectLayout 校验本地 OCI 布局，不执行镜像中的任何程序。
// maxBytes 同时约束压缩输入和展开内容，不能使用逻辑超卖额度替代物理预算。
func InspectLayout(ctx context.Context, directory, digest, architecture string, maxBytes int64) (Image, error) {
	var image Image
	if !digestPattern.MatchString(digest) || (architecture != "amd64" && architecture != "arm64") || maxBytes <= 0 || maxBytes > 16<<40 {
		return image, errors.New("无效的镜像摘要、架构或转换预算")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return image, err
	}
	defer root.Close()
	layout, err := readMetadata(ctx, root, "oci-layout", 1024)
	if err != nil {
		return image, err
	}
	var version struct {
		Version string `json:"imageLayoutVersion"`
	}
	if err := json.Unmarshal(layout, &version); err != nil || version.Version != "1.0.0" {
		return image, errors.New("不支持的 OCI 布局版本")
	}
	data, err := readBlob(ctx, root, Descriptor{Digest: digest, Size: -1}, metadataLimit)
	if err != nil {
		return image, err
	}
	var manifest imageManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return image, err
	}
	selected := Descriptor{Digest: digest, Size: int64(len(data)), MediaType: manifest.MediaType}
	if manifest.SchemaVersion != 2 {
		return image, errors.New("不支持的镜像 schema")
	}
	if manifest.MediaType == ociIndex || manifest.MediaType == dockerIndex {
		var matches []Descriptor
		for _, item := range manifest.Manifests {
			p := item.Platform
			if p != nil && p.OS == "linux" && p.Architecture == architecture && (p.Variant == "" || architecture == "arm64" && p.Variant == "v8") {
				matches = append(matches, item)
			}
		}
		if len(matches) != 1 {
			return image, errors.New("镜像索引必须包含唯一匹配的 Linux 平台")
		}
		selected = matches[0]
		if selected.Size <= 0 {
			return image, errors.New("镜像清单大小必须为正数")
		}
		if selected.MediaType != ociManifest && selected.MediaType != dockerManifest {
			return image, errors.New("不支持嵌套镜像索引")
		}
		data, err = readBlob(ctx, root, selected, metadataLimit)
		if err != nil {
			return image, err
		}
		manifest = imageManifest{}
		if err := json.Unmarshal(data, &manifest); err != nil {
			return image, err
		}
	}
	if manifest.SchemaVersion != 2 || (manifest.MediaType != ociManifest && manifest.MediaType != dockerManifest) || selected.MediaType != manifest.MediaType || len(manifest.Layers) == 0 || len(manifest.Layers) > 256 {
		return image, errors.New("不支持的镜像清单或层数量")
	}
	if manifest.Config.MediaType != "application/vnd.oci.image.config.v1+json" && manifest.Config.MediaType != "application/vnd.docker.container.image.v1+json" {
		return image, errors.New("不支持的镜像配置类型")
	}
	if manifest.Config.Size <= 0 {
		return image, errors.New("镜像配置大小必须为正数")
	}
	data, err = readBlob(ctx, root, manifest.Config, metadataLimit)
	if err != nil {
		return image, err
	}
	var config struct {
		Architecture string `json:"architecture"`
		OS           string `json:"os"`
		Config       struct {
			Volumes map[string]json.RawMessage `json:"Volumes"`
		} `json:"config"`
		RootFS struct {
			Type    string   `json:"type"`
			DiffIDs []string `json:"diff_ids"`
		} `json:"rootfs"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return image, err
	}
	if len(config.Config.Volumes) != 0 {
		return image, errors.New("平台镜像不允许声明匿名VOLUME")
	}
	if config.OS != "linux" || config.Architecture != architecture || config.RootFS.Type != "layers" || len(config.RootFS.DiffIDs) != len(manifest.Layers) {
		return image, errors.New("镜像配置的平台或文件系统与清单不匹配")
	}
	compressed, expanded := maxBytes, maxBytes
	for i, layer := range manifest.Layers {
		if !digestPattern.MatchString(config.RootFS.DiffIDs[i]) {
			return image, errors.New("无效的镜像层 DiffID")
		}
		if layer.Size <= 0 || layer.Size > compressed {
			return image, errors.New("镜像压缩内容超过转换预算")
		}
		compressed -= layer.Size
		n, err := verifyLayer(ctx, root, layer, config.RootFS.DiffIDs[i], expanded)
		if err != nil {
			return image, fmt.Errorf("校验镜像层 %d: %w", i, err)
		}
		expanded -= n
	}
	return Image{Manifest: selected, Config: manifest.Config, Layers: manifest.Layers, DiffIDs: config.RootFS.DiffIDs}, nil
}

func blobPath(d Descriptor) (string, error) {
	if !digestPattern.MatchString(d.Digest) || len(d.URLs) != 0 {
		return "", errors.New("只支持本地 SHA256 blob，不允许外部层地址")
	}
	return filepath.Join("blobs", "sha256", strings.TrimPrefix(d.Digest, "sha256:")), nil
}

func openBlob(root *os.Root, d Descriptor, limit int64) (*os.File, error) {
	name, err := blobPath(d)
	if err != nil {
		return nil, err
	}
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 0 || info.Size() > limit || d.Size >= 0 && info.Size() != d.Size {
		return nil, errors.New("镜像 blob 类型或长度不匹配")
	}
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		file.Close()
		return nil, errors.New("镜像 blob 在读取期间发生变化")
	}
	return file, nil
}

func readMetadata(ctx context.Context, root *os.Root, name string, limit int64) ([]byte, error) {
	file, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(contextReader{ctx, file}, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("镜像元数据超过上限")
	}
	return data, nil
}

func readBlob(ctx context.Context, root *os.Root, d Descriptor, limit int64) ([]byte, error) {
	file, err := openBlob(root, d, limit)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(contextReader{ctx, file}, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit || d.Size >= 0 && int64(len(data)) != d.Size {
		return nil, errors.New("镜像 blob 长度发生变化")
	}
	hash := sha256.Sum256(data)
	if "sha256:"+hex.EncodeToString(hash[:]) != d.Digest {
		return nil, errors.New("镜像 blob 摘要不匹配")
	}
	return data, nil
}

func verifyLayer(ctx context.Context, root *os.Root, d Descriptor, diffID string, budget int64) (int64, error) {
	if budget <= 0 {
		return 0, errors.New("镜像展开内容超过转换预算")
	}
	file, err := openBlob(root, d, d.Size)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	compressedHash, expandedHash := sha256.New(), sha256.New()
	input := io.TeeReader(io.LimitReader(contextReader{ctx, file}, d.Size+1), compressedHash)
	var reader io.Reader = input
	switch d.MediaType {
	case "application/vnd.oci.image.layer.v1.tar", "application/vnd.docker.image.rootfs.diff.tar":
	case "application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.docker.image.rootfs.diff.tar.gzip":
		gz, err := gzip.NewReader(input)
		if err != nil {
			return 0, err
		}
		defer gz.Close()
		reader = gz
	default:
		return 0, errors.New("暂不支持此层压缩格式")
	}
	n, err := io.Copy(expandedHash, io.LimitReader(reader, budget+1))
	if err != nil {
		return 0, err
	}
	if n > budget {
		return 0, errors.New("镜像展开内容超过转换预算")
	}
	if _, err := io.Copy(io.Discard, input); err != nil {
		return 0, err
	}
	info, err := file.Stat()
	if err != nil || info.Size() != d.Size {
		return 0, errors.New("镜像层长度发生变化")
	}
	if "sha256:"+hex.EncodeToString(compressedHash.Sum(nil)) != d.Digest || "sha256:"+hex.EncodeToString(expandedHash.Sum(nil)) != diffID {
		return 0, errors.New("镜像层摘要或 DiffID 不匹配")
	}
	// 先扫描归档逻辑大小及条目，阻止小体积 sparse/PAX 记录在解包时膨胀。
	if err := inspectTar(ctx, root, d, budget); err != nil {
		return 0, err
	}
	return n, nil
}

func inspectTar(ctx context.Context, root *os.Root, d Descriptor, budget int64) error {
	f, err := openBlob(root, d, d.Size)
	if err != nil {
		return err
	}
	defer f.Close()
	var input io.Reader = contextReader{ctx, f}
	if strings.HasSuffix(d.MediaType, "gzip") {
		gz, err := gzip.NewReader(input)
		if err != nil {
			return err
		}
		defer gz.Close()
		input = gz
	}
	tr := tar.NewReader(io.LimitReader(input, budget+1))
	var logical, files int64
	for {
		header, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		files++
		if files > 1000000 || len(header.Name) > 4096 || header.Size < 0 || header.Size > budget-logical {
			return errors.New("镜像归档逻辑容量或文件数超过上限")
		}
		logical += header.Size
		if header.Typeflag == tar.TypeGNUSparse {
			return errors.New("镜像转换不接受GNU sparse条目")
		}
		for name := range header.PAXRecords {
			if strings.HasPrefix(name, "GNU.sparse") || strings.HasPrefix(name, "SCHILY.realsize") {
				return errors.New("镜像转换不接受稀疏归档扩展")
			}
		}
		switch header.Typeflag {
		case tar.TypeReg, tar.TypeRegA, tar.TypeDir, tar.TypeSymlink, tar.TypeLink:
		default:
			return errors.New("镜像归档包含未允许的设备或特殊条目")
		}
	}
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
