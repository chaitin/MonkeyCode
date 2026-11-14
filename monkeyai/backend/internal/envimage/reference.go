package envimage

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
)

var versionTag = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)

func readableRepository(reference string) string {
	ref, _ := source(reference)
	return "environments/" + path.Base(ref.RepositoryStr())
}
func imageVersion(image v1.Image) (string, error) {
	config, err := image.ConfigFile()
	if err != nil {
		return "", err
	}
	version := config.Config.Labels["org.opencontainers.image.version"]
	if version != "" && (!versionTag.MatchString(version) || strings.EqualFold(version, "latest")) {
		return "", errors.New("镜像版本标签格式无效")
	}
	return version, nil
}
func indexVersion(index v1.ImageIndex) (string, error) {
	manifest, err := index.IndexManifest()
	if err != nil {
		return "", err
	}
	var version string
	for _, item := range manifest.Manifests {
		if item.Platform == nil || item.Platform.OS != "linux" || !slices.Contains([]string{"amd64", "arm64"}, item.Platform.Architecture) {
			continue
		}
		image, err := index.Image(item.Digest)
		if err != nil {
			return "", err
		}
		value, err := imageVersion(image)
		if err != nil {
			return "", err
		}
		if version != "" && value != "" && value != version {
			return "", errors.New("双架构镜像版本标签不一致")
		}
		if value != "" {
			version = value
		}
	}
	return version, nil
}
func (s *Service) reserveTarget(reference, version string) (name.Tag, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ref, err := source(reference)
	if err != nil {
		return name.Tag{}, err
	}
	current := s.images[reference]
	if current.Reference != "" && !strings.Contains(current.Reference, "@") {
		tag, err := name.NewTag(current.Reference, name.StrictValidation)
		if err == nil && strings.HasPrefix(tag.RepositoryStr(), "environments/") {
			return name.NewTag(s.internal+"/"+tag.RepositoryStr()+":"+tag.TagStr(), name.Insecure)
		}
	}
	repository := readableRepository(reference)
	occupied := func(tag string) bool {
		for existing, image := range s.images {
			if existing == reference || image.Reference == "" || strings.Contains(image.Reference, "@") {
				continue
			}
			target, err := name.NewTag(image.Reference, name.StrictValidation)
			if err != nil {
				continue
			}
			if target.RepositoryStr() == repository && target.TagStr() == tag {
				original, err := source(existing)
				if err != nil || original.DigestStr() != ref.DigestStr() {
					return true
				}
			}
		}
		return false
	}
	if version != "" && occupied(version) {
		return name.Tag{}, errors.New("同名同版本镜像已对应不同摘要，请使用新的版本标签")
	}
	if version == "" {
		for number := 1; ; number++ {
			candidate := fmt.Sprint("v", number)
			if !occupied(candidate) {
				version = candidate
				break
			}
		}
	}
	current.Source = reference
	current.Reference = s.host + "/" + repository + ":" + version
	current.Status = "syncing"
	current.UpdatedAt = time.Now().UTC()
	images := maps.Clone(s.images)
	images[reference] = current
	if err := s.writeCatalog(images, s.defaultSource); err != nil {
		return name.Tag{}, err
	}
	s.images = images
	return name.NewTag(s.internal+"/"+repository+":"+version, name.Insecure)
}
func (s *Service) checkTarget(ctx context.Context, target name.Tag, digest string) error {
	descriptor, err := remote.Get(target, remote.WithContext(ctx), remote.WithTransport(s.transport))
	if err != nil {
		var failure *transport.Error
		if errors.As(err, &failure) && failure.StatusCode == http.StatusNotFound {
			return nil
		}
		return err
	}
	if descriptor.Digest.String() != digest {
		return errors.New("仓库已有同版本不同内容，拒绝覆盖")
	}
	return nil
}
func (s *Service) publicTag(target name.Tag) string {
	return s.host + "/" + target.RepositoryStr() + ":" + target.TagStr()
}
