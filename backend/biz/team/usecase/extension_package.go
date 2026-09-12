package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/aiguard"
	"github.com/chaitin/MonkeyCode/backend/pkg/auditmeta"
)

type teamExtensionPackageUsecase struct {
	repo              domain.TeamExtensionPackageRepo
	skillUsecase      domain.TeamSkillUsecase
	guard             domain.SkillGuard
	objstore          agentresource.ObjectStore
	stageFinalizer    domain.ExtensionPackageStageFinalizer
	ruleImporter      extensionPackageRuleImporter
	staticDir         string
	staticRoutePrefix string
	guardWaitTimeout  time.Duration
	logger            *slog.Logger
}

type extensionPackageRuleImporter interface {
	ImportRules(ctx context.Context, userID uuid.UUID, pkg *parsedExtensionPackage) (domain.ExtensionRuleImportResult, error)
}

func NewTeamExtensionPackageUsecase(i *do.Injector) (domain.TeamExtensionPackageUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	dbClient := do.MustInvoke[*db.Client](i)
	return &teamExtensionPackageUsecase{
		repo:              do.MustInvoke[domain.TeamExtensionPackageRepo](i),
		skillUsecase:      do.MustInvoke[domain.TeamSkillUsecase](i),
		guard:             aiguard.NewClient(cfg.AIGuard),
		objstore:          do.MustInvoke[agentresource.ObjectStore](i),
		stageFinalizer:    do.MustInvoke[domain.ExtensionPackageStageFinalizer](i),
		ruleImporter:      &extensionRuleImporter{db: dbClient},
		staticDir:         cfg.StaticFiles.Dir,
		staticRoutePrefix: cfg.StaticFiles.RoutePrefix,
		guardWaitTimeout:  positiveDuration(cfg.AIGuard.WaitTimeout, defaultGuardWaitTimeout),
		logger:            do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (u *teamExtensionPackageUsecase) Import(ctx context.Context, teamUser *domain.TeamUser, req *domain.ImportTeamExtensionPackageReq) (*domain.ImportTeamExtensionPackageResp, error) {
	pkg, err := parseExtensionPackage(req.Data)
	if err != nil {
		return nil, err
	}

	teamID := teamUser.GetTeamID()
	skillImports := extensionSkillImports(pkg)
	stageKey := ""
	stageCreated := false
	if len(skillImports) > 0 {
		stageKey = extensionPackageStageKey(teamID)
		result, err := u.guard.ScanObserved(ctx, domain.SkillGuardRequest{
			Name:     pkg.PackageID,
			Version:  pkg.Version,
			Filename: req.Filename,
			Package:  req.Data,
		}, func(task *domain.SkillGuardResult) error {
			if u.objstore == nil {
				return errors.New("extension package staging object store is unavailable")
			}
			prefix, filename := path.Split(stageKey)
			if err := u.objstore.PutFile(ctx, strings.TrimSuffix(prefix, "/"), filename, bytes.NewReader(req.Data)); err != nil {
				return err
			}
			stageCreated = true
			deadline := time.Now().Add(u.waitTimeout())
			for _, skill := range skillImports {
				if _, err := u.skillUsecase.Add(ctx, teamUser, &domain.AddTeamSkillReq{
					Name:                   skill.Name,
					Description:            skill.Description,
					Tags:                   skill.Tags,
					Content:                skill.Content,
					SkillMDPath:            skill.Path,
					SourceType:             "extension-package",
					SourceLabel:            pkg.PackageID,
					ExtensionPackageID:     pkg.PackageID,
					GuardChecked:           true,
					GuardTaskID:            task.TaskID,
					GuardDeadline:          deadline,
					GuardStageKey:          stageKey,
					PendingGuardOwner:      domain.SkillGuardOwnerExtensionPackage,
					PendingPackageFilename: req.Filename,
					PendingPackageVersion:  pkg.Version,
				}); err != nil {
					return err
				}
			}
			return nil
		})
		auditmeta.SetGuardResult(ctx, result)
		if err != nil {
			if stageCreated {
				if isRequestCancellation(err) {
					if enqueueErr := u.skillUsecase.EnqueueGuardStage(context.WithoutCancel(ctx), stageKey); enqueueErr != nil {
						u.logger.ErrorContext(ctx, "failed to enqueue cancelled extension package scan", "stage_key", stageKey, "error", enqueueErr)
					}
				} else {
					u.rejectExtensionStage(ctx, teamID, stageKey, err)
				}
			}
			return nil, err
		}
		if stageCreated {
			finalized, err := u.finalizeExtensionStage(ctx, teamID, teamUser.User.ID, stageKey, pkg.PackageID, pkg.Version)
			if err != nil {
				if !isRequestCancellation(err) {
					u.rejectExtensionStage(ctx, teamID, stageKey, err)
				}
				return nil, err
			}
			if err := u.skillUsecase.ApproveGuardStage(ctx, teamID, stageKey); err != nil {
				if !isRequestCancellation(err) {
					u.rejectExtensionStage(ctx, teamID, stageKey, err)
				}
				return nil, err
			}
			u.discardExtensionStage(ctx, stageKey)
			return &domain.ImportTeamExtensionPackageResp{
				PackageID:     pkg.PackageID,
				Version:       pkg.Version,
				CreatedRules:  finalized.CreatedRules,
				UpdatedRules:  finalized.UpdatedRules,
				UpdatedSkills: len(skillImports),
				CreatedImages: finalized.CreatedImages,
				UpdatedImages: finalized.UpdatedImages,
			}, nil
		}
	}

	var ruleResult domain.ExtensionRuleImportResult
	if u.ruleImporter != nil {
		ruleResult, err = u.ruleImporter.ImportRules(ctx, teamUser.User.ID, pkg)
		if err != nil {
			return nil, err
		}
	}

	// Skill 导入:复用 TeamSkillUsecase.Add 走 bare repo + agent_skill 标准流程。
	// extension_version 作为 agent_skill_version 的版本号,name 做幂等匹配。
	var createdSkills, updatedSkills int
	for _, s := range skillImports {
		_, err := u.skillUsecase.Add(ctx, teamUser, &domain.AddTeamSkillReq{
			Name:               s.Name,
			Description:        s.Description,
			Tags:               s.Tags,
			Content:            s.Content,
			SkillMDPath:        s.Path,
			SourceType:         "extension-package",
			SourceLabel:        pkg.PackageID,
			ExtensionPackageID: pkg.PackageID,
			GuardChecked:       true,
		})
		if err != nil {
			return nil, err
		}
		// Add 内部按 name upsert:已存在 → 新版本(算 updated),不存在 → 新建(算 created)。
		// 这里简化为全算 updated(首次也创建了 version);精确区分需要 Add 返回 created flag。
		updatedSkills++
	}

	// Image 导入:保持原有流程。
	images, err := publishExtensionImages(u.staticDir, u.staticRoutePrefix, teamID, pkg)
	if err != nil {
		return nil, err
	}
	importReq := &domain.TeamExtensionImport{
		PackageID: pkg.PackageID,
		Version:   pkg.Version,
		Images:    images,
	}
	result, err := u.repo.ImportResources(ctx, teamID, teamUser.User.ID, importReq)
	if err != nil {
		return nil, err
	}
	result.CreatedSkills = createdSkills
	result.UpdatedSkills = updatedSkills
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
		CreatedRules:  ruleResult.CreatedRules,
		UpdatedRules:  ruleResult.UpdatedRules,
		CreatedSkills: result.CreatedSkills,
		UpdatedSkills: result.UpdatedSkills,
		CreatedImages: result.CreatedImages,
		UpdatedImages: result.UpdatedImages,
	}, nil
}

const extensionPackageStagePrefix = "agent-resources/extension-package-staging"

func extensionPackageStageKey(teamID uuid.UUID) string {
	return path.Join(extensionPackageStagePrefix, teamID.String(), uuid.NewString(), "package.zip")
}

func (u *teamExtensionPackageUsecase) waitTimeout() time.Duration {
	if u.guardWaitTimeout > 0 {
		return u.guardWaitTimeout
	}
	return defaultGuardWaitTimeout
}

func (u *teamExtensionPackageUsecase) finalizeExtensionStage(ctx context.Context, teamID, userID uuid.UUID, stageKey, packageID, version string) (*domain.ExtensionPackageStageResult, error) {
	if u.stageFinalizer == nil {
		return nil, errors.New("extension package stage finalizer is unavailable")
	}
	return u.stageFinalizer.Finalize(ctx, stageKey, teamID, userID, packageID, version)
}

func (u *teamExtensionPackageUsecase) rejectExtensionStage(ctx context.Context, teamID uuid.UUID, stageKey string, scanErr error) {
	cleanupCtx := context.WithoutCancel(ctx)
	if err := u.skillUsecase.RejectGuardStage(cleanupCtx, stageKey, scanErr); err != nil {
		u.logger.ErrorContext(ctx, "failed to reject extension package guard stage", "team_id", teamID, "error", err)
		if enqueueErr := u.skillUsecase.EnqueueGuardStage(cleanupCtx, stageKey); enqueueErr != nil {
			u.logger.ErrorContext(ctx, "failed to enqueue extension package guard stage recovery", "team_id", teamID, "stage_key", stageKey, "error", enqueueErr)
		}
		return
	}
	u.discardExtensionStage(cleanupCtx, stageKey)
}

func (u *teamExtensionPackageUsecase) discardExtensionStage(ctx context.Context, stageKey string) {
	if u.stageFinalizer == nil || strings.TrimSpace(stageKey) == "" {
		return
	}
	if err := u.stageFinalizer.Discard(ctx, stageKey); err != nil {
		u.logger.WarnContext(ctx, "failed to discard extension package guard stage", "stage_key", stageKey, "error", err)
	}
}

type noopExtensionPackageRuleImporter struct{}

func (noopExtensionPackageRuleImporter) ImportRules(context.Context, uuid.UUID, *parsedExtensionPackage) (domain.ExtensionRuleImportResult, error) {
	return domain.ExtensionRuleImportResult{}, nil
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
	return writeExtensionImageManifests(u.staticDir, teamID, archives)
}

func writeExtensionImageManifests(staticDir string, teamID uuid.UUID, archives []*db.TeamExtensionImageArchive) error {
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
		path := filepath.Join(staticDir, "extensions", "teams", teamID.String(), "images", arch, "manifest.json")
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
