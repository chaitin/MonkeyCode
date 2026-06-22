package usecase

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestTeamExtensionPackageUsecaseImportWritesAggregatedManifest(t *testing.T) {
	ctx := context.Background()
	staticDir := t.TempDir()
	teamID := uuid.New()
	userID := uuid.New()
	repo := &extensionPackageRepoStub{
		archives: []*db.TeamExtensionImageArchive{{
			TeamID:           teamID,
			PackageID:        "pack",
			ExtensionImageID: "devbox",
			Version:          "1.0.0",
			Arch:             "x86_64",
			ImageName:        "repo/devbox:1",
			ArchiveURL:       "/static/extensions/teams/team/pack/1.0.0/images/x86_64/devbox.tar.gz",
			Sha256:           "sha256",
		}},
	}
	u := &teamExtensionPackageUsecase{
		repo:              repo,
		ruleImporter:      &extensionPackageRuleImporterStub{},
		staticDir:         staticDir,
		staticRoutePrefix: "/static",
		logger:            slog.Default(),
	}
	data := makeExtensionZip(t, map[string]string{
		"manifest.json":        `{"package_id":"pack","version":"1.0.0","images":[{"image_id":"devbox","name":"repo/devbox:1","archives":[{"arch":"x86_64","archive":"images/devbox.tar.gz"}]}]}`,
		"images/devbox.tar.gz": "image",
	})

	resp, err := u.Import(ctx, &domain.TeamUser{User: &domain.User{ID: userID}, Team: &domain.Team{ID: teamID}}, &domain.ImportTeamExtensionPackageReq{
		Filename: "pack.zip",
		Data:     data,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.PackageID != "pack" || resp.Version != "1.0.0" {
		t.Fatalf("response = %#v", resp)
	}
	if repo.importReq == nil || len(repo.importReq.Images) != 1 || len(repo.importReq.Images[0].Archives) != 1 {
		t.Fatalf("import request = %#v", repo.importReq)
	}

	manifestPath := filepath.Join(staticDir, "extensions", "teams", teamID.String(), "images", "x86_64", "manifest.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("manifest not written: %v", err)
	}
	var manifest extensionImagesManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.TeamID != teamID.String() || manifest.Arch != "x86_64" || len(manifest.Packages) != 1 {
		t.Fatalf("manifest = %#v", manifest)
	}
	if got := manifest.Packages[0].Images[0].ArchiveURL; got != "/static/extensions/teams/team/pack/1.0.0/images/x86_64/devbox.tar.gz" {
		t.Fatalf("archive url = %q", got)
	}
}

func TestTeamExtensionPackageUsecaseImportReturnsRuleCounts(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	ruleImporter := &extensionPackageRuleImporterStub{created: 1}
	u := &teamExtensionPackageUsecase{
		repo:              &extensionPackageRepoStub{},
		ruleImporter:      ruleImporter,
		staticDir:         t.TempDir(),
		staticRoutePrefix: "/static",
		logger:            slog.Default(),
	}
	data := makeExtensionZip(t, map[string]string{
		"manifest.json":       `{"package_id":"pack","version":"1.0.0","rules":[{"rule_id":"codex-base","name":"codex-base","path":"rules/codex-base.md"}]}`,
		"rules/codex-base.md": "# Codex Base\n",
	})

	resp, err := u.Import(ctx, &domain.TeamUser{User: &domain.User{ID: userID}, Team: &domain.Team{ID: teamID}}, &domain.ImportTeamExtensionPackageReq{
		Filename: "pack.zip",
		Data:     data,
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.CreatedRules != 1 || resp.UpdatedRules != 0 {
		t.Fatalf("rule counts = created %d updated %d", resp.CreatedRules, resp.UpdatedRules)
	}
}

type extensionPackageRepoStub struct {
	importReq *domain.TeamExtensionImport
	archives  []*db.TeamExtensionImageArchive
}

func (s *extensionPackageRepoStub) ImportResources(_ context.Context, _, _ uuid.UUID, req *domain.TeamExtensionImport) (*domain.TeamExtensionImportResult, error) {
	s.importReq = req
	return &domain.TeamExtensionImportResult{
		CreatedImages: len(req.Images),
		CreatedSkills: len(req.Skills),
	}, nil
}

func (s *extensionPackageRepoStub) ListImageArchives(_ context.Context, _ uuid.UUID) ([]*db.TeamExtensionImageArchive, error) {
	return s.archives, nil
}

type extensionPackageRuleImporterStub struct {
	created int
	updated int
}

func (s *extensionPackageRuleImporterStub) ImportRules(_ context.Context, _ uuid.UUID, _ *parsedExtensionPackage) (domain.ExtensionRuleImportResult, error) {
	return domain.ExtensionRuleImportResult{CreatedRules: s.created, UpdatedRules: s.updated}, nil
}
