package usecase

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestExtensionPackageStageFinalizerRestoresResources(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	staticDir := t.TempDir()
	data := makeExtensionZip(t, map[string]string{
		"manifest.json":        `{"package_id":"pack","version":"1.0.0","rules":[{"rule_id":"rule-a","name":"rule-a","path":"rules/a.md"}],"images":[{"image_id":"devbox","name":"repo/devbox:1","archives":[{"arch":"x86_64","archive":"images/devbox.tar.gz"}]}]}`,
		"rules/a.md":           "# A\n",
		"images/devbox.tar.gz": "image",
	})
	store := &extensionPackageStageObjectStoreStub{data: data}
	repo := &extensionPackageRepoStub{archives: []*db.TeamExtensionImageArchive{{
		TeamID: teamID, PackageID: "pack", Version: "1.0.0", ExtensionImageID: "devbox", Arch: "x86_64", ImageName: "repo/devbox:1",
	}}}
	finalizer := &extensionPackageStageFinalizer{
		repo:              repo,
		ruleImporter:      &extensionPackageRuleImporterStub{created: 1},
		objstore:          store,
		staticDir:         staticDir,
		staticRoutePrefix: "/static",
		maxPackageSize:    1 << 20,
	}

	result, err := finalizer.Finalize(ctx, "stage/package.zip", teamID, userID, "pack", "1.0.0")
	if err != nil {
		t.Fatalf("Finalize() error = %v", err)
	}
	if result.CreatedRules != 1 || repo.importReq == nil || len(repo.importReq.Images) != 1 {
		t.Fatalf("finalize result=%#v import=%#v", result, repo.importReq)
	}
	if _, err := os.Stat(filepath.Join(staticDir, "extensions", "teams", teamID.String(), "images", "x86_64", "manifest.json")); err != nil {
		t.Fatalf("manifest not written: %v", err)
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

type extensionPackageStageObjectStoreStub struct {
	data    []byte
	deleted string
}

func (s *extensionPackageStageObjectStoreStub) GetObject(_ context.Context, _ string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(s.data)), nil
}

func (s *extensionPackageStageObjectStoreStub) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", nil
}

func (s *extensionPackageStageObjectStoreStub) PutFile(_ context.Context, prefix, filename string, body io.Reader) error {
	data, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	s.data = data
	s.deleted = ""
	_ = prefix
	_ = filename
	return nil
}

func (s *extensionPackageStageObjectStoreStub) DeleteObject(_ context.Context, key string) error {
	s.deleted = key
	return nil
}

func (s *extensionPackageRuleImporterStub) ImportRules(_ context.Context, _ uuid.UUID, _ *parsedExtensionPackage) (domain.ExtensionRuleImportResult, error) {
	return domain.ExtensionRuleImportResult{CreatedRules: s.created, UpdatedRules: s.updated}, nil
}
