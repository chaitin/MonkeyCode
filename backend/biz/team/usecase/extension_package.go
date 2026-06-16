package usecase

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type teamExtensionPackageUsecase struct {
	repo              domain.TeamExtensionPackageRepo
	staticDir         string
	staticRoutePrefix string
	logger            *slog.Logger
}

func NewTeamExtensionPackageUsecase(i *do.Injector) (domain.TeamExtensionPackageUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	return &teamExtensionPackageUsecase{
		repo:              do.MustInvoke[domain.TeamExtensionPackageRepo](i),
		staticDir:         cfg.StaticFiles.Dir,
		staticRoutePrefix: cfg.StaticFiles.RoutePrefix,
		logger:            do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (u *teamExtensionPackageUsecase) Import(ctx context.Context, teamUser *domain.TeamUser, req *domain.ImportTeamExtensionPackageReq) (*domain.ImportTeamExtensionPackageResp, error) {
	pkg, err := parseExtensionPackage(req.Data)
	if err != nil {
		return nil, err
	}

	teamID := teamUser.GetTeamID()
	images, err := publishExtensionImages(u.staticDir, u.staticRoutePrefix, teamID, pkg)
	if err != nil {
		return nil, err
	}
	importReq := &domain.TeamExtensionImport{
		PackageID: pkg.PackageID,
		Version:   pkg.Version,
		Skills:    extensionSkillImports(pkg),
		Images:    images,
	}
	result, err := u.repo.ImportResources(ctx, teamID, teamUser.User.ID, importReq)
	if err != nil {
		return nil, err
	}
	archives, err := u.repo.ListImageArchives(ctx, teamID)
	if err != nil {
		return nil, err
	}
	if err := u.writeImageManifests(teamID, archives); err != nil {
		return nil, err
	}
	return &domain.ImportTeamExtensionPackageResp{
		PackageID:     pkg.PackageID,
		Version:       pkg.Version,
		CreatedSkills: result.CreatedSkills,
		UpdatedSkills: result.UpdatedSkills,
		CreatedImages: result.CreatedImages,
		UpdatedImages: result.UpdatedImages,
	}, nil
}

func extensionSkillImports(pkg *parsedExtensionPackage) []domain.TeamExtensionSkillImport {
	skills := make([]domain.TeamExtensionSkillImport, 0, len(pkg.Skills))
	for _, item := range pkg.Skills {
		skills = append(skills, domain.TeamExtensionSkillImport{
			SkillID:     item.SkillID,
			Name:        item.Name,
			Description: item.Description,
			Tags:        item.Tags,
			Content:     item.Content,
			Path:        item.Path,
		})
	}
	return skills
}

type extensionImagesManifest struct {
	TeamID   string                           `json:"team_id"`
	Arch     string                           `json:"arch"`
	Packages []extensionImagesManifestPackage `json:"packages"`
}

type extensionImagesManifestPackage struct {
	PackageID string                         `json:"package_id"`
	Version   string                         `json:"version"`
	Images    []extensionImagesManifestImage `json:"images"`
}

type extensionImagesManifestImage struct {
	ImageID    string `json:"image_id"`
	Name       string `json:"name"`
	ArchiveURL string `json:"archive_url"`
	SHA256     string `json:"sha256,omitempty"`
}

func (u *teamExtensionPackageUsecase) writeImageManifests(teamID uuid.UUID, archives []*db.TeamExtensionImageArchive) error {
	byArch := map[string][]*db.TeamExtensionImageArchive{}
	for _, archive := range archives {
		if strings.TrimSpace(archive.Arch) == "" {
			continue
		}
		byArch[archive.Arch] = append(byArch[archive.Arch], archive)
	}
	for arch, items := range byArch {
		manifest := buildExtensionImagesManifest(teamID, arch, items)
		data, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			return err
		}
		path := filepath.Join(u.staticDir, "extensions", "teams", teamID.String(), "images", arch, "manifest.json")
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func buildExtensionImagesManifest(teamID uuid.UUID, arch string, archives []*db.TeamExtensionImageArchive) extensionImagesManifest {
	sort.SliceStable(archives, func(i, j int) bool {
		if archives[i].PackageID != archives[j].PackageID {
			return archives[i].PackageID < archives[j].PackageID
		}
		if archives[i].ExtensionImageID != archives[j].ExtensionImageID {
			return archives[i].ExtensionImageID < archives[j].ExtensionImageID
		}
		return archives[i].ArchiveURL < archives[j].ArchiveURL
	})

	manifest := extensionImagesManifest{
		TeamID: teamID.String(),
		Arch:   arch,
	}
	packageIndexes := map[string]int{}
	for _, archive := range archives {
		key := archive.PackageID + "\x00" + archive.Version
		index, ok := packageIndexes[key]
		if !ok {
			index = len(manifest.Packages)
			packageIndexes[key] = index
			manifest.Packages = append(manifest.Packages, extensionImagesManifestPackage{
				PackageID: archive.PackageID,
				Version:   archive.Version,
			})
		}
		manifest.Packages[index].Images = append(manifest.Packages[index].Images, extensionImagesManifestImage{
			ImageID:    archive.ExtensionImageID,
			Name:       archive.ImageName,
			ArchiveURL: archive.ArchiveURL,
			SHA256:     archive.Sha256,
		})
	}
	return manifest
}
