package usecase

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type extensionPackageManifest struct {
	PackageID string                   `json:"package_id"`
	Version   string                   `json:"version"`
	Skills    []extensionSkillManifest `json:"skills"`
	Images    []extensionImageManifest `json:"images"`
}

type extensionSkillManifest struct {
	SkillID string `json:"skill_id"`
	Path    string `json:"path"`
}

type extensionImageManifest struct {
	ImageID  string                          `json:"image_id"`
	Name     string                          `json:"name"`
	Remark   string                          `json:"remark"`
	Archives []extensionImageArchiveManifest `json:"archives"`
}

type extensionImageArchiveManifest struct {
	Arch    string `json:"arch"`
	Archive string `json:"archive"`
	SHA256  string `json:"sha256"`
}

type parsedExtensionPackage struct {
	PackageID string
	Version   string
	Skills    []parsedExtensionSkill
	Images    []parsedExtensionImage
}

type parsedExtensionSkill struct {
	SkillID     string
	Name        string
	Description string
	Tags        []string
	Content     string
	Path        string
}

type parsedExtensionImage struct {
	ImageID  string
	Name     string
	Remark   string
	Archives []parsedExtensionImageArchive
}

type parsedExtensionImageArchive struct {
	Arch     string
	Filename string
	Data     []byte
	SHA256   string
}

func parseExtensionPackage(data []byte) (*parsedExtensionPackage, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid extension package"))
	}
	files := map[string]*zip.File{}
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		name := filepath.ToSlash(file.Name)
		files[name] = file
	}
	manifestFile := files["manifest.json"]
	if manifestFile == nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("extension package missing manifest.json"))
	}
	rawManifest, err := readExtensionZipFile(manifestFile)
	if err != nil {
		return nil, err
	}
	var manifest extensionPackageManifest
	if err := json.Unmarshal(rawManifest, &manifest); err != nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid extension manifest"))
	}
	if strings.TrimSpace(manifest.PackageID) == "" || strings.TrimSpace(manifest.Version) == "" {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("extension manifest missing package_id or version"))
	}

	pkg := &parsedExtensionPackage{
		PackageID: strings.TrimSpace(manifest.PackageID),
		Version:   strings.TrimSpace(manifest.Version),
	}
	seenSkills := map[string]bool{}
	for _, item := range manifest.Skills {
		skillID := strings.TrimSpace(item.SkillID)
		if skillID == "" {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("extension skill missing skill_id"))
		}
		if seenSkills[skillID] {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("duplicate extension skill %s", skillID))
		}
		seenSkills[skillID] = true
		path, err := safeExtensionPath(item.Path)
		if err != nil {
			return nil, err
		}
		file := files[path]
		if file == nil {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("extension skill file not found: %s", path))
		}
		content, err := readExtensionZipFile(file)
		if err != nil {
			return nil, err
		}
		meta, err := parseSkillFrontmatter(string(content))
		if err != nil {
			return nil, err
		}
		pkg.Skills = append(pkg.Skills, parsedExtensionSkill{
			SkillID:     skillID,
			Name:        meta.name,
			Description: meta.description,
			Tags:        meta.tags,
			Content:     string(content),
			Path:        path,
		})
	}

	seenImages := map[string]bool{}
	for _, item := range manifest.Images {
		imageID := strings.TrimSpace(item.ImageID)
		if imageID == "" || strings.TrimSpace(item.Name) == "" {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("extension image missing image_id or name"))
		}
		if seenImages[imageID] {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("duplicate extension image %s", imageID))
		}
		seenImages[imageID] = true
		image := parsedExtensionImage{
			ImageID: imageID,
			Name:    strings.TrimSpace(item.Name),
			Remark:  strings.TrimSpace(item.Remark),
		}
		seenArch := map[string]bool{}
		for _, archive := range item.Archives {
			arch := strings.TrimSpace(archive.Arch)
			if arch != "x86_64" && arch != "aarch64" {
				return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("unsupported extension image arch %s", arch))
			}
			if seenArch[arch] {
				return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("duplicate extension image arch %s", arch))
			}
			seenArch[arch] = true
			path, err := safeExtensionPath(archive.Archive)
			if err != nil {
				return nil, err
			}
			if !isImageArchive(path) {
				return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("unsupported image archive %s", path))
			}
			file := files[path]
			if file == nil {
				return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("extension image archive not found: %s", path))
			}
			content, err := readExtensionZipFile(file)
			if err != nil {
				return nil, err
			}
			if want := strings.TrimSpace(archive.SHA256); want != "" {
				if got := sha256Hex(content); got != want {
					return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("sha256 mismatch for %s", path))
				}
			}
			image.Archives = append(image.Archives, parsedExtensionImageArchive{
				Arch:     arch,
				Filename: filepath.Base(path),
				Data:     content,
				SHA256:   strings.TrimSpace(archive.SHA256),
			})
		}
		pkg.Images = append(pkg.Images, image)
	}
	return pkg, nil
}

func readExtensionZipFile(file *zip.File) ([]byte, error) {
	rc, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

func safeExtensionPath(raw string) (string, error) {
	path := filepath.ToSlash(strings.TrimSpace(raw))
	if path == "" {
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("extension path is empty"))
	}
	clean := filepath.ToSlash(filepath.Clean(path))
	if filepath.IsAbs(clean) || clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("extension path escapes package: %s", raw))
	}
	return clean, nil
}

func isImageArchive(path string) bool {
	name := strings.ToLower(path)
	return strings.HasSuffix(name, ".tar") || strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz")
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

type skillFrontmatter struct {
	name        string
	description string
	tags        []string
}

func parseSkillFrontmatter(content string) (skillFrontmatter, error) {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return skillFrontmatter{}, errcode.ErrBadRequest.Wrap(fmt.Errorf("SKILL.md missing frontmatter"))
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return skillFrontmatter{}, errcode.ErrBadRequest.Wrap(fmt.Errorf("SKILL.md missing frontmatter end"))
	}
	meta := skillFrontmatter{}
	for i := 1; i < end; i++ {
		key, value, ok := strings.Cut(lines[i], ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		switch key {
		case "name":
			meta.name = stripYAMLQuotes(value)
		case "description":
			meta.description = stripYAMLQuotes(value)
		case "tags":
			meta.tags = parseYAMLTags(value)
		}
	}
	if meta.name == "" || meta.description == "" {
		return skillFrontmatter{}, errcode.ErrBadRequest.Wrap(fmt.Errorf("SKILL.md missing name or description"))
	}
	return meta, nil
}

func parseYAMLTags(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if strings.HasPrefix(value, "[") && strings.HasSuffix(value, "]") {
		value = strings.TrimPrefix(strings.TrimSuffix(value, "]"), "[")
	}
	parts := regexp.MustCompile(`[，,;]`).Split(value, -1)
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		tag := stripYAMLQuotes(strings.TrimSpace(part))
		if tag == "" || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}

func stripYAMLQuotes(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}
