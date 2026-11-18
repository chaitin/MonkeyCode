package vmimage

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
)

var repositoryPattern = regexp.MustCompile(`^environments/[a-z0-9]+(?:[a-z0-9._/-]*[a-z0-9])?$`)

type Registry struct {
	client *control.Client
	host   string
}

func NewRegistry(client *control.Client, host string) (*Registry, error) {
	if client == nil || host == "" || client.HTTP == nil {
		return nil, errors.New("缺少当前中心服务镜像身份")
	}
	if err := control.ValidateServer(client.Server); err != nil {
		return nil, err
	}
	if err := control.ValidateServer(client.URL); err != nil {
		return nil, err
	}
	return &Registry{client, host}, nil
}
func (r *Registry) credentials(reference string) (string, string, string, error) {
	registry, rest, ok := strings.Cut(reference, "/")
	if !ok {
		return "", "", "", errors.New("镜像引用缺少仓库")
	}
	server, err := url.Parse(r.client.URL)
	if err != nil || !strings.EqualFold(server.Host, registry) {
		return "", "", "", errors.New("镜像只允许来自当前中心服务")
	}
	repository, digest, ok := strings.Cut(rest, "@")
	if !ok || !repositoryPattern.MatchString(repository) || !digestPattern.MatchString(digest) {
		return "", "", "", errors.New("镜像必须使用固定摘要的environments引用")
	}
	for _, part := range strings.Split(repository, "/") {
		if part == "" || part == "." || part == ".." {
			return "", "", "", errors.New("仓库路径包含非规范段")
		}
	}
	encoded, err := r.client.RegistryAuth(r.host, reference)
	if err != nil {
		return "", "", "", err
	}
	raw, err := base64.URLEncoding.DecodeString(encoded)
	if err != nil {
		return "", "", "", err
	}
	var auth struct{ Username, Password string }
	if json.Unmarshal(raw, &auth) != nil || auth.Username != r.host || auth.Password == "" {
		return "", "", "", errors.New("仓库签名凭据无效")
	}
	return repository, digest, auth.Password, nil
}
func (r *Registry) get(ctx context.Context, repository, kind, digest, password string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, "GET", r.client.URL+"/v2/"+repository+"/"+kind+"/"+digest, nil)
	if err != nil {
		return nil, err
	}
	request.SetBasicAuth(r.host, password)
	if kind == "manifests" {
		request.Header.Set("Accept", strings.Join([]string{ociIndex, ociManifest, dockerIndex, dockerManifest}, ", "))
	}
	client := *r.client.HTTP
	client.Timeout = 0
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("拒绝镜像仓库重定向") }
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != 200 {
		response.Body.Close()
		return nil, fmt.Errorf("中心服务镜像资源未就绪或不可用，状态码%d", response.StatusCode)
	}
	return response, nil
}

// Pull 生成私有OCI布局并返回已校验的实际平台manifest；不会回源公网。
func (r *Registry) Pull(ctx context.Context, reference, architecture string, budget int64, destination string) (Image, error) {
	if (architecture != "amd64" && architecture != "arm64") || budget <= 0 || budget > 16<<40 || !filepath.IsAbs(destination) || filepath.Clean(destination) != destination {
		return Image{}, errors.New("镜像下载架构、预算或目录无效")
	}
	repository, requested, password, err := r.credentials(reference)
	if err != nil {
		return Image{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	// 仅创建新目录，不能覆盖之前的下载、用户盘或其他操作的暂存区。
	if err := os.Mkdir(destination, 0700); err != nil {
		return Image{}, err
	}
	success := false
	defer func() {
		if !success {
			os.RemoveAll(destination)
		}
	}()
	if err := os.MkdirAll(filepath.Join(destination, "blobs", "sha256"), 0700); err != nil {
		return Image{}, err
	}
	remaining := budget
	metadata := func(digest string, expected int64) ([]byte, error) {
		response, err := r.get(ctx, repository, "manifests", digest, password)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(response.Body, metadataLimit+1))
		if err != nil {
			return nil, err
		}
		if int64(len(raw)) > metadataLimit || int64(len(raw)) > remaining || expected >= 0 && int64(len(raw)) != expected || digestBytes(raw) != digest {
			return nil, errors.New("镜像清单大小或摘要不符")
		}
		name := filepath.Join(destination, "blobs", "sha256", strings.TrimPrefix(digest, "sha256:"))
		if err := os.WriteFile(name, raw, 0600); err != nil {
			return nil, err
		}
		remaining -= int64(len(raw))
		return raw, nil
	}
	raw, err := metadata(requested, -1)
	if err != nil {
		return Image{}, err
	}
	var manifest imageManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return Image{}, err
	}
	selected := requested
	if manifest.MediaType == ociIndex || manifest.MediaType == dockerIndex {
		if manifest.SchemaVersion != 2 {
			return Image{}, errors.New("镜像索引版本无效")
		}
		var candidates []Descriptor
		for _, d := range manifest.Manifests {
			p := d.Platform
			if p != nil && p.OS == "linux" && p.Architecture == architecture && (p.Variant == "" || architecture == "arm64" && p.Variant == "v8") {
				candidates = append(candidates, d)
			}
		}
		if len(candidates) != 1 {
			return Image{}, errors.New("索引没有唯一匹配的平台镜像")
		}
		d := candidates[0]
		if _, err := blobPath(d); err != nil {
			return Image{}, err
		}
		if d.Size <= 0 || (d.MediaType != ociManifest && d.MediaType != dockerManifest) {
			return Image{}, errors.New("子镜像清单无效")
		}
		raw, err = metadata(d.Digest, d.Size)
		if err != nil {
			return Image{}, err
		}
		manifest = imageManifest{}
		if err := json.Unmarshal(raw, &manifest); err != nil {
			return Image{}, err
		}
		if manifest.MediaType != d.MediaType {
			return Image{}, errors.New("子清单媒体类型不一致")
		}
		selected = d.Digest
	}
	if manifest.SchemaVersion != 2 || (manifest.MediaType != ociManifest && manifest.MediaType != dockerManifest) || len(manifest.Layers) == 0 || len(manifest.Layers) > 256 {
		return Image{}, errors.New("镜像清单或层数无效")
	}
	seen := map[string]bool{}
	for _, d := range append([]Descriptor{manifest.Config}, manifest.Layers...) {
		if _, err := blobPath(d); err != nil {
			return Image{}, err
		}
		if d.Size <= 0 || d.Size > remaining {
			return Image{}, errors.New("镜像下载超过物理预算")
		}
		if seen[d.Digest] {
			continue
		}
		seen[d.Digest] = true
		response, err := r.get(ctx, repository, "blobs", d.Digest, password)
		if err != nil {
			return Image{}, err
		}
		path := filepath.Join(destination, "blobs", "sha256", strings.TrimPrefix(d.Digest, "sha256:"))
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			response.Body.Close()
			return Image{}, err
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, d.Size+1))
		copyErr = errors.Join(copyErr, response.Body.Close(), file.Sync(), file.Close())
		if copyErr != nil {
			return Image{}, copyErr
		}
		if n != d.Size || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != d.Digest {
			return Image{}, errors.New("镜像blob长度或摘要不一致")
		}
		remaining -= d.Size
	}
	if err := os.WriteFile(filepath.Join(destination, "oci-layout"), []byte(`{"imageLayoutVersion":"1.0.0"}`), 0600); err != nil {
		return Image{}, err
	}
	image, err := InspectLayout(ctx, destination, requested, architecture, budget)
	if err != nil {
		return Image{}, err
	}
	if image.Manifest.Digest != selected {
		return Image{}, errors.New("镜像下载平台清单不一致")
	}
	success = true
	return image, nil
}
