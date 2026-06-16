package usecase

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

func publishExtensionImages(staticDir, routePrefix string, teamID uuid.UUID, pkg *parsedExtensionPackage) ([]domain.TeamExtensionImageImport, error) {
	images := make([]domain.TeamExtensionImageImport, 0, len(pkg.Images))
	for _, image := range pkg.Images {
		out := domain.TeamExtensionImageImport{
			ImageID: image.ImageID,
			Name:    image.Name,
			Remark:  image.Remark,
		}
		for _, archive := range image.Archives {
			rel := filepath.Join("extensions", "teams", teamID.String(), pkg.PackageID, pkg.Version, "images", archive.Arch, image.ImageID+archiveExt(archive.Filename))
			dst := filepath.Join(staticDir, rel)
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return nil, err
			}
			if err := os.WriteFile(dst, archive.Data, 0o644); err != nil {
				return nil, err
			}
			out.Archives = append(out.Archives, domain.TeamExtensionImageArchiveImport{
				Arch:        archive.Arch,
				SHA256:      archive.SHA256,
				ArchivePath: dst,
				ArchiveURL:  "/" + strings.Trim(routePrefix, "/") + "/" + filepath.ToSlash(rel),
			})
		}
		images = append(images, out)
	}
	return images, nil
}

func archiveExt(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".tar.gz"):
		return ".tar.gz"
	case strings.HasSuffix(lower, ".tgz"):
		return ".tgz"
	case strings.HasSuffix(lower, ".tar"):
		return ".tar"
	default:
		return filepath.Ext(name)
	}
}
