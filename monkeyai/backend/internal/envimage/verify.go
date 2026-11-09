package envimage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
)

type ImportStatus struct {
	Ready         bool     `json:"ready"`
	Default       bool     `json:"default"`
	Source        string   `json:"source"`
	Reference     string   `json:"reference,omitempty"`
	Digest        string   `json:"digest,omitempty"`
	Architectures []string `json:"architectures,omitempty"`
}

func (s *Service) localDescriptor(ctx context.Context, reference string) (*remote.Descriptor, error) {
	ref, err := source(reference)
	if err != nil {
		return nil, err
	}
	repositories := []string{}
	s.mu.Lock()
	image := s.images[reference]
	s.mu.Unlock()
	if image.Reference != "" {
		if target, err := name.ParseReference(image.Reference, name.StrictValidation); err == nil {
			repositories = append(repositories, target.Context().RepositoryStr())
		}
	}
	for _, repository := range []string{readableRepository(reference), Repository(reference)} {
		if !slices.Contains(repositories, repository) {
			repositories = append(repositories, repository)
		}
	}
	for _, repository := range repositories {
		target, err := name.NewDigest(s.internal+"/"+repository+"@"+ref.DigestStr(), name.Insecure)
		if err != nil {
			return nil, err
		}
		descriptor, err := remote.Get(target, remote.WithContext(ctx), remote.WithTransport(s.transport))
		if err != nil {
			var failure *transport.Error
			if errors.As(err, &failure) && failure.StatusCode == http.StatusNotFound {
				continue
			}
			return nil, err
		}
		if descriptor.Digest.String() != ref.DigestStr() {
			return nil, errors.New("Registry镜像摘要与固定来源不一致")
		}
		return descriptor, nil
	}
	return nil, nil
}
func verifyBlob(ctx context.Context, stream io.ReadCloser, expected v1.Hash, size int64) error {
	defer stream.Close()
	if size < 0 || size > 16<<30 || expected.Algorithm != "sha256" {
		return errors.New("Registry资源摘要或大小无效")
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(stream, size+1))
	if err != nil {
		return err
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if n != size || hex.EncodeToString(hash.Sum(nil)) != expected.Hex {
		return errors.New("Registry资源内容不完整或摘要不匹配")
	}
	return nil
}
func verifyImage(ctx context.Context, image v1.Image) error {
	manifest, err := image.Manifest()
	if err != nil {
		return err
	}
	if manifest.Config.Size < 0 || manifest.Config.Size > 8<<20 {
		return errors.New("Registry镜像配置大小无效")
	}
	raw, err := image.RawConfigFile()
	if err != nil {
		return err
	}
	if err := verifyBlob(ctx, io.NopCloser(strings.NewReader(string(raw))), manifest.Config.Digest, manifest.Config.Size); err != nil {
		return err
	}
	layers, err := image.Layers()
	if err != nil {
		return err
	}
	if len(layers) != len(manifest.Layers) || len(layers) > 100000 {
		return errors.New("Registry镜像层清单无效")
	}
	for i, layer := range layers {
		stream, err := layer.Compressed()
		if err != nil {
			return err
		}
		if err := verifyBlob(ctx, stream, manifest.Layers[i].Digest, manifest.Layers[i].Size); err != nil {
			return err
		}
	}
	return nil
}
func verifyIndex(ctx context.Context, index v1.ImageIndex, depth int) error {
	if depth > 4 {
		return errors.New("Registry索引嵌套过深")
	}
	manifest, err := index.IndexManifest()
	if err != nil {
		return err
	}
	if len(manifest.Manifests) > 4096 {
		return errors.New("Registry索引数量过多")
	}
	for _, item := range manifest.Manifests {
		if item.MediaType.IsIndex() {
			child, err := index.ImageIndex(item.Digest)
			if err != nil {
				return err
			}
			if err := verifyIndex(ctx, child, depth+1); err != nil {
				return err
			}
		} else {
			image, err := index.Image(item.Digest)
			if err != nil {
				return err
			}
			if err := verifyImage(ctx, image); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Service) Check(ctx context.Context, reference string) (ImportStatus, error) {
	result := ImportStatus{Source: reference}
	ref, err := source(reference)
	if err != nil {
		return result, err
	}
	descriptor, err := s.localDescriptor(ctx, reference)
	if err != nil {
		return result, err
	}
	if descriptor == nil {
		return result, nil
	}
	if descriptor.MediaType.IsIndex() {
		index, err := descriptor.ImageIndex()
		if err != nil {
			return result, err
		}
		if err := verifyIndex(ctx, index, 0); err != nil {
			return result, err
		}
		manifest, err := index.IndexManifest()
		if err != nil {
			return result, err
		}
		for _, item := range manifest.Manifests {
			if item.Platform != nil && item.Platform.OS == "linux" && slices.Contains([]string{"amd64", "arm64"}, item.Platform.Architecture) && !slices.Contains(result.Architectures, item.Platform.Architecture) {
				result.Architectures = append(result.Architectures, item.Platform.Architecture)
			}
		}
	} else {
		image, err := descriptor.Image()
		if err != nil {
			return result, err
		}
		if err := verifyImage(ctx, image); err != nil {
			return result, err
		}
		config, err := image.ConfigFile()
		if err != nil {
			return result, err
		}
		if config.OS == "linux" {
			result.Architectures = []string{config.Architecture}
		}
	}
	if len(result.Architectures) == 0 {
		return result, errors.New("Registry缺少可用Linux架构")
	}
	s.mu.Lock()
	result.Reference = s.images[reference].Reference
	result.Default = s.defaultSource == reference
	s.mu.Unlock()
	result.Ready = true
	result.Digest = ref.DigestStr()
	return result, nil
}
func (s *Service) Restore(ctx context.Context, reference string) error {
	descriptor, err := s.localDescriptor(ctx, reference)
	if err != nil {
		return err
	}
	if descriptor == nil {
		return errors.New("Registry缺少指定镜像，需要导入资源")
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
func (s *Service) Prepare(ctx context.Context, reference, directory string) (ImportStatus, error) {
	if _, err := source(reference); err != nil {
		return ImportStatus{}, err
	}
	if directory != "" {
		if err := s.importDirectory(ctx, directory, reference); err != nil {
			return ImportStatus{}, err
		}
	} else {
		status, err := s.Check(ctx, reference)
		if err != nil {
			return status, err
		}
		if !status.Ready {
			return status, errors.New("Registry缺少完整镜像资源")
		}
		if err := s.Restore(ctx, reference); err != nil {
			return status, err
		}
		if err := ctx.Err(); err != nil {
			return status, err
		}
		if err := s.selectDefault(reference); err != nil {
			return status, err
		}
	}
	return s.Check(ctx, reference)
}
