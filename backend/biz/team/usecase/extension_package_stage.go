package usecase

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

// extensionPackageStageFinalizer is the restart-safe completion path for an
// extension package whose package-level guard scan returned a non-terminal
// task. Skill versions are staged separately; this component restores the
// non-Skill resources from the temporary package object only after approval.
type extensionPackageStageFinalizer struct {
	repo              domain.TeamExtensionPackageRepo
	ruleImporter      extensionPackageRuleImporter
	objstore          agentresource.ObjectStore
	staticDir         string
	staticRoutePrefix string
	maxPackageSize    int64
}

func NewExtensionPackageStageFinalizer(i *do.Injector) (domain.ExtensionPackageStageFinalizer, error) {
	cfg := do.MustInvoke[*config.Config](i)
	maxSize := int64(cfg.ObjectStorage.MaxSize)
	if maxSize <= 0 {
		maxSize = 50 << 20
	}
	return &extensionPackageStageFinalizer{
		repo:              do.MustInvoke[domain.TeamExtensionPackageRepo](i),
		ruleImporter:      &extensionRuleImporter{db: do.MustInvoke[*db.Client](i)},
		objstore:          do.MustInvoke[agentresource.ObjectStore](i),
		staticDir:         cfg.StaticFiles.Dir,
		staticRoutePrefix: cfg.StaticFiles.RoutePrefix,
		maxPackageSize:    maxSize,
	}, nil
}

func (f *extensionPackageStageFinalizer) Finalize(ctx context.Context, stageKey string, teamID, userID uuid.UUID, packageID, version string) (*domain.ExtensionPackageStageResult, error) {
	if f == nil || f.objstore == nil {
		return nil, fmt.Errorf("extension package stage finalizer: object store is unavailable")
	}
	stageKey = strings.TrimSpace(stageKey)
	if stageKey == "" {
		return nil, fmt.Errorf("extension package stage finalizer: empty stage key")
	}
	body, err := f.objstore.GetObject(ctx, stageKey)
	if err != nil {
		return nil, fmt.Errorf("extension package stage finalizer: read staged package: %w", err)
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, f.maxPackageSize+1))
	if err != nil {
		return nil, fmt.Errorf("extension package stage finalizer: read staged package body: %w", err)
	}
	if int64(len(data)) > f.maxPackageSize {
		return nil, fmt.Errorf("extension package stage finalizer: staged package exceeds size limit")
	}
	pkg, err := parseExtensionPackage(data)
	if err != nil {
		return nil, err
	}
	if packageID = strings.TrimSpace(packageID); packageID != "" && pkg.PackageID != packageID {
		return nil, fmt.Errorf("extension package stage finalizer: staged package id %q does not match %q", pkg.PackageID, packageID)
	}
	if version = strings.TrimSpace(version); version != "" && pkg.Version != version {
		return nil, fmt.Errorf("extension package stage finalizer: staged package version %q does not match %q", pkg.Version, version)
	}
	var ruleResult domain.ExtensionRuleImportResult
	if f.ruleImporter != nil {
		ruleResult, err = f.ruleImporter.ImportRules(ctx, userID, pkg)
		if err != nil {
			return nil, err
		}
	}
	images, err := publishExtensionImages(f.staticDir, f.staticRoutePrefix, teamID, pkg)
	if err != nil {
		return nil, err
	}
	result, err := f.repo.ImportResources(ctx, teamID, userID, &domain.TeamExtensionImport{
		PackageID: pkg.PackageID,
		Version:   pkg.Version,
		Images:    images,
	})
	if err != nil {
		return nil, err
	}
	archives, err := f.repo.ListImageArchives(ctx, teamID)
	if err != nil {
		return nil, err
	}
	if err := writeExtensionImageManifests(f.staticDir, teamID, archives); err != nil {
		return nil, err
	}
	return &domain.ExtensionPackageStageResult{
		CreatedRules:  ruleResult.CreatedRules,
		UpdatedRules:  ruleResult.UpdatedRules,
		CreatedImages: result.CreatedImages,
		UpdatedImages: result.UpdatedImages,
	}, nil
}

func (f *extensionPackageStageFinalizer) Discard(ctx context.Context, stageKey string) error {
	if f == nil || f.objstore == nil {
		return nil
	}
	stageKey = strings.TrimSpace(stageKey)
	if stageKey == "" {
		return nil
	}
	return f.objstore.DeleteObject(ctx, stageKey)
}
