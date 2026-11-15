package envimage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/distribution/distribution/v3/configuration"
	"github.com/distribution/distribution/v3/registry/handlers"
	_ "github.com/distribution/distribution/v3/registry/storage/driver/filesystem"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/layout"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

type Image struct {
	Source        string    `json:"source"`
	Reference     string    `json:"reference"`
	Status        string    `json:"status"`
	Architectures []string  `json:"architectures"`
	Error         string    `json:"error,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Service struct {
	root, host, internal string
	defaultSource        string
	reader               http.Handler
	writer               *http.Server
	transport            *http.Transport
	ctx                  context.Context
	cancel               context.CancelFunc
	mu                   sync.Mutex
	images               map[string]Image
	authorize            func(*http.Request) bool
	wg                   sync.WaitGroup
	close                sync.Once
}

func New(ctx context.Context, root, publicURL string) (*Service, error) {
	u, err := url.Parse(publicURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("环境镜像仓库需要 HTTP(S) 根地址")
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	child, cancel := context.WithCancel(ctx)
	s := &Service{root: root, host: u.Host, ctx: child, cancel: cancel, images: map[string]Image{}}
	stored, err := readCatalog(root)
	if err != nil {
		cancel()
		return nil, err
	}
	s.images, s.defaultSource = stored.Images, stored.Default
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		cancel()
		return nil, err
	}
	makeHandler := func(readOnly bool) http.Handler {
		cfg := &configuration.Configuration{Version: configuration.CurrentVersion, Storage: configuration.Storage{
			"filesystem":  configuration.Parameters{"rootdirectory": filepath.Join(root, "registry")},
			"maintenance": configuration.Parameters{"uploadpurging": map[interface{}]interface{}{"enabled": false}, "readonly": map[interface{}]interface{}{"enabled": readOnly}},
		}}
		cfg.Log.Level = "error"
		cfg.Log.AccessLog.Disabled = true
		cfg.HTTP.Secret = hex.EncodeToString(secret)
		cfg.HTTP.RelativeURLs = true
		return handlers.NewApp(child, cfg)
	}
	s.reader = makeHandler(true)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		cancel()
		return nil, err
	}
	s.internal = listener.Addr().String()
	s.writer = &http.Server{Handler: makeHandler(false), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: time.Minute}
	s.transport = http.DefaultTransport.(*http.Transport).Clone()
	s.transport.Proxy = nil
	s.wg.Add(1)
	go func() { defer s.wg.Done(); _ = s.writer.Serve(listener) }()
	context.AfterFunc(child, func() { _ = s.writer.Close() })
	return s, nil
}

func (s *Service) Close() {
	s.close.Do(func() {
		s.mu.Lock()
		s.cancel()
		s.mu.Unlock()
		_ = s.writer.Close()
		s.wg.Wait()
		s.transport.CloseIdleConnections()
	})
}
func (s *Service) WithAuthorize(fn func(*http.Request) bool) *Service { s.authorize = fn; return s }
func source(reference string) (name.Digest, error) {
	ref, err := name.NewDigest(reference, name.StrictValidation)
	if err != nil || !strings.HasPrefix(ref.DigestStr(), "sha256:") || len(ref.DigestStr()) != 71 || strings.Trim(strings.TrimPrefix(ref.DigestStr(), "sha256:"), "0123456789abcdef") != "" {
		return name.Digest{}, errors.New("环境镜像必须使用固定 SHA-256 仓库引用")
	}
	return ref, nil
}
func Key(reference string) string {
	sum := sha256.Sum256([]byte(reference))
	return hex.EncodeToString(sum[:])
}
func Repository(reference string) string { return "environments/" + Key(reference) }
func (s *Service) target(reference string) (name.Tag, error) {
	return name.NewTag(s.internal+"/"+Repository(reference)+":source", name.Insecure)
}
func (s *Service) Default(ctx context.Context, arch string) (string, string, error) {
	if err := ctx.Err(); err != nil {
		return "", "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	image, ok := s.images[s.defaultSource]
	if !ok || image.Status != "ready" || !slices.Contains(image.Architectures, arch) {
		return "", "", errors.New("server 默认环境镜像尚未准备完成")
	}
	ref, err := source(image.Source)
	if err != nil {
		return "", "", err
	}
	if strings.Contains(image.Reference, "@") || image.Reference == "" {
		return "", "", errors.New("请完成默认镜像的版本标签迁移")
	}
	tag, err := name.NewTag(image.Reference, name.StrictValidation)
	if err != nil {
		return "", "", err
	}
	return s.host + "/" + tag.RepositoryStr() + ":" + tag.TagStr(), ref.DigestStr(), nil
}
func (s *Service) Resolve(ctx context.Context, reference, arch string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, image := range s.images {
		if image.Status != "ready" || !slices.Contains(image.Architectures, arch) {
			continue
		}
		ref, err := source(image.Source)
		if err != nil {
			return "", err
		}
		legacy := s.host + "/" + Repository(image.Source) + "@" + ref.DigestStr()
		if reference == legacy {
			return reference, nil
		}
		repository := Repository(image.Source)
		if image.Reference != "" {
			if target, err := name.ParseReference(image.Reference, name.StrictValidation); err == nil {
				repository = target.Context().RepositoryStr()
			}
		}
		resolved := s.host + "/" + repository + "@" + ref.DigestStr()
		if reference == image.Source || reference == image.Reference || reference == resolved {
			return resolved, nil
		}
	}
	return "", errors.New("server 镜像资源或对应架构尚未准备完成")
}
func (s *Service) Sync(ctx context.Context, reference string) error {
	ref, err := source(reference)
	if err != nil {
		return err
	}
	if ref.RegistryStr() == s.host {
		return errors.New("不能从 server 仓库回源同步自身")
	}
	descriptor, err := remote.Get(ref, remote.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("读取上游镜像: %w", err)
	}
	if descriptor.Digest.String() != ref.DigestStr() {
		return errors.New("上游镜像摘要不匹配")
	}
	if descriptor.MediaType.IsIndex() {
		index, err := descriptor.ImageIndex()
		if err != nil {
			return err
		}
		return s.pushIndex(ctx, reference, index)
	}
	image, err := descriptor.Image()
	if err != nil {
		return err
	}
	return s.pushImage(ctx, reference, image)
}
func (s *Service) pushIndex(ctx context.Context, reference string, index v1.ImageIndex) error {
	digest, err := index.Digest()
	if err != nil {
		return err
	}
	ref, err := source(reference)
	if err != nil || digest.String() != ref.DigestStr() {
		return errors.New("镜像索引摘要不匹配")
	}
	manifest, err := index.IndexManifest()
	if err != nil {
		return err
	}
	arches := []string{}
	for _, item := range manifest.Manifests {
		if item.Platform != nil && item.Platform.OS == "linux" && (item.Platform.Architecture == "amd64" || item.Platform.Architecture == "arm64") && !slices.Contains(arches, item.Platform.Architecture) {
			arches = append(arches, item.Platform.Architecture)
		}
	}
	if len(arches) == 0 {
		return errors.New("镜像没有可用的 Linux 架构")
	}
	version, err := indexVersion(index)
	if err != nil {
		return err
	}
	target, err := s.reserveTarget(reference, version)
	if err != nil {
		return err
	}
	if err := s.checkTarget(ctx, target, ref.DigestStr()); err != nil {
		return err
	}
	if err := remote.WriteIndex(target, index, remote.WithContext(ctx), remote.WithTransport(s.transport)); err != nil {
		return err
	}
	return s.save(Image{Source: reference, Reference: s.publicTag(target), Status: "ready", Architectures: arches, UpdatedAt: time.Now().UTC()})
}
func (s *Service) pushImage(ctx context.Context, reference string, image v1.Image) error {
	ref, err := source(reference)
	if err != nil {
		return err
	}
	digest, err := image.Digest()
	if err != nil || digest.String() != ref.DigestStr() {
		return errors.New("镜像摘要不匹配")
	}
	config, err := image.ConfigFile()
	if err != nil {
		return err
	}
	if config.OS != "linux" || (config.Architecture != "amd64" && config.Architecture != "arm64") {
		return errors.New("镜像架构不支持")
	}
	version, err := imageVersion(image)
	if err != nil {
		return err
	}
	target, err := s.reserveTarget(reference, version)
	if err != nil {
		return err
	}
	if err := s.checkTarget(ctx, target, ref.DigestStr()); err != nil {
		return err
	}
	if err := remote.Write(target, image, remote.WithContext(ctx), remote.WithTransport(s.transport)); err != nil {
		return err
	}
	return s.save(Image{Source: reference, Reference: s.publicTag(target), Status: "ready", Architectures: []string{config.Architecture}, UpdatedAt: time.Now().UTC()})
}

// Import 只读取安装器已校验的 OCI 目录，镜像内容由 Registry 再按摘要检查。
func (s *Service) Import(ctx context.Context, directory string) error {
	if _, err := os.Stat(filepath.Join(directory, "catalog.json")); os.IsNotExist(err) {
		s.mu.Lock()
		selected := s.defaultSource
		s.mu.Unlock()
		if selected != "" {
			status, checkErr := s.Check(ctx, selected)
			if checkErr == nil && status.Ready {
				return nil
			}
			if checkErr != nil {
				return checkErr
			}
		}
		return err
	} else if err != nil {
		return err
	}
	return s.importDirectory(ctx, directory, "")
}
func (s *Service) importDirectory(ctx context.Context, directory, selected string) error {
	raw, err := os.ReadFile(filepath.Join(directory, "catalog.json"))
	if err != nil {
		return err
	}
	var references []string
	if len(raw) > 64<<10 || json.Unmarshal(raw, &references) != nil || len(references) > 100 {
		return errors.New("镜像导入清单无效")
	}
	for _, reference := range references {
		ref, err := source(reference)
		if err != nil {
			return err
		}
		status, err := s.Check(ctx, reference)
		if err != nil {
			return err
		}
		if status.Ready {
			if err := s.Restore(ctx, reference); err != nil {
				return err
			}
			continue
		}
		index, err := layout.Path(filepath.Join(directory, Key(reference))).ImageIndex()
		if err != nil {
			return err
		}
		hash, err := v1.NewHash(ref.DigestStr())
		if err != nil {
			return err
		}
		manifest, err := index.IndexManifest()
		if err != nil {
			return err
		}
		found := false
		for _, descriptor := range manifest.Manifests {
			if descriptor.Digest != hash {
				continue
			}
			found = true
			if descriptor.MediaType.IsIndex() {
				child, err := index.ImageIndex(hash)
				if err != nil {
					return err
				}
				if err := s.pushIndex(ctx, reference, child); err != nil {
					return err
				}
			} else {
				child, err := index.Image(hash)
				if err != nil {
					return err
				}
				if err := s.pushImage(ctx, reference, child); err != nil {
					return err
				}
			}
		}
		if !found {
			return errors.New("OCI 导入缺少指定镜像摘要")
		}
	}
	if len(references) == 0 {
		return errors.New("镜像导入清单不能为空")
	}
	if selected == "" {
		selected = references[0]
	}
	status, err := s.Check(ctx, selected)
	if err != nil {
		return err
	}
	if !status.Ready {
		return errors.New("默认镜像未完整导入")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.selectDefault(selected)
}
