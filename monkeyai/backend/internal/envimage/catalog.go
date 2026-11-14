package envimage

import (
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
)

type catalog struct {
	Version int              `json:"version"`
	Default string           `json:"default"`
	Images  map[string]Image `json:"images"`
}

func readCatalog(root string) (catalog, error) {
	result := catalog{Version: 1, Images: map[string]Image{}}
	raw, err := os.ReadFile(filepath.Join(root, "catalog.json"))
	if os.IsNotExist(err) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if len(raw) > 4<<20 {
		return result, errors.New("环境镜像目录过大")
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return result, errors.New("环境镜像目录损坏")
	}
	if _, ok := fields["images"]; ok {
		if json.Unmarshal(raw, &result) != nil || result.Version != 1 || result.Images == nil {
			return result, errors.New("环境镜像目录格式无效")
		}
	} else if json.Unmarshal(raw, &result.Images) != nil || result.Images == nil {
		return result, errors.New("旧环境镜像目录损坏")
	}
	for key, image := range result.Images {
		if key != image.Source {
			return result, errors.New("环境镜像归属不一致")
		}
		if _, err := source(image.Source); err != nil {
			return result, err
		}
		if image.Status == "syncing" {
			image.Status, image.Error = "failed", "同步中断，请重试"
			result.Images[key] = image
		}
	}
	if result.Default != "" {
		_, ok := result.Images[result.Default]
		if !ok {
			return result, errors.New("环境默认镜像记录不完整")
		}
	}
	return result, nil
}
func (s *Service) writeCatalog(images map[string]Image, selected string) error {
	raw, err := json.Marshal(catalog{Version: 1, Default: selected, Images: images})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(s.root, ".catalog-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err := file.Write(raw); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), filepath.Join(s.root, "catalog.json")); err != nil {
		return err
	}
	directory, err := os.Open(s.root)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
func (s *Service) save(image Image) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	images := maps.Clone(s.images)
	images[image.Source] = image
	if err := s.writeCatalog(images, s.defaultSource); err != nil {
		return err
	}
	s.images = images
	return nil
}
func (s *Service) selectDefault(reference string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	image, ok := s.images[reference]
	if !ok || image.Status != "ready" {
		return errors.New("默认镜像资源尚未准备完成")
	}
	if err := s.writeCatalog(s.images, reference); err != nil {
		return err
	}
	s.defaultSource = reference
	return nil
}
