package repo

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/db/image"
	"github.com/chaitin/MonkeyCode/backend/db/skill"
	"github.com/chaitin/MonkeyCode/backend/db/teamextensionimagearchive"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestTeamExtensionPackageRepoImportResourcesUpsertsByExtensionID(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	group := createTeamRepoDefaultGroup(t, client, teamID)
	repo := &teamExtensionPackageRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	req := &domain.TeamExtensionImport{
		PackageID: "pack",
		Version:   "1.0.0",
		Skills: []domain.TeamExtensionSkillImport{{
			SkillID:     "reviewer",
			Name:        "Reviewer",
			Description: "Review code",
			Tags:        []string{"review"},
			Content:     "---\nname: Reviewer\ndescription: Review code\n---\n",
			Path:        "skills/reviewer/SKILL.md",
		}},
		Images: []domain.TeamExtensionImageImport{{
			ImageID: "devbox",
			Name:    "repo/devbox:1",
			Remark:  "Devbox",
			Archives: []domain.TeamExtensionImageArchiveImport{{
				Arch:        "x86_64",
				SHA256:      "sha256-first",
				ArchivePath: "static/extensions/devbox.tar.gz",
				ArchiveURL:  "/static/extensions/devbox.tar.gz",
			}},
		}},
	}

	first, err := repo.ImportResources(ctx, teamID, userID, req)
	if err != nil {
		t.Fatal(err)
	}
	if first.CreatedSkills != 1 || first.CreatedImages != 1 || first.UpdatedSkills != 0 || first.UpdatedImages != 0 {
		t.Fatalf("first result = %#v", first)
	}
	createdSkill, err := client.Skill.Query().
		Where(skill.ExtensionPackageID("pack"), skill.ExtensionSkillID("reviewer")).
		Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if exists := teamRepoSkillInGroup(t, client, group.ID, createdSkill.ID); !exists {
		t.Fatal("extension skill was not added to default group")
	}
	createdImage, err := client.Image.Query().
		Where(image.ExtensionPackageID("pack"), image.ExtensionImageID("devbox")).
		Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if exists := teamRepoImageInGroup(t, client, group.ID, createdImage.ID); !exists {
		t.Fatal("extension image was not added to default group")
	}

	req.Version = "1.1.0"
	req.Skills[0].Description = "Updated"
	req.Images[0].Remark = "Updated image"
	req.Images[0].Archives[0].ArchivePath = "static/extensions/devbox-v2.tar.gz"
	req.Images[0].Archives[0].ArchiveURL = "/static/extensions/devbox-v2.tar.gz"
	req.Images[0].Archives[0].SHA256 = "sha256-second"
	second, err := repo.ImportResources(ctx, teamID, userID, req)
	if err != nil {
		t.Fatal(err)
	}
	if second.CreatedSkills != 0 || second.CreatedImages != 0 || second.UpdatedSkills != 1 || second.UpdatedImages != 1 {
		t.Fatalf("second result = %#v", second)
	}

	if count, err := client.Skill.Query().Where(skill.ExtensionPackageID("pack"), skill.ExtensionSkillID("reviewer")).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("skill count = %d, want 1", count)
	}
	updatedSkill, err := client.Skill.Query().
		Where(skill.ExtensionPackageID("pack"), skill.ExtensionSkillID("reviewer")).
		Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if updatedSkill.Description != "Updated" || updatedSkill.ExtensionVersion != "1.1.0" {
		t.Fatalf("updated skill = %#v", updatedSkill)
	}
	if count, err := client.Image.Query().Where(image.ExtensionPackageID("pack"), image.ExtensionImageID("devbox")).Count(ctx); err != nil {
		t.Fatal(err)
	} else if count != 1 {
		t.Fatalf("image count = %d, want 1", count)
	}
	updatedArchive, err := client.TeamExtensionImageArchive.Query().
		Where(
			teamextensionimagearchive.PackageID("pack"),
			teamextensionimagearchive.ExtensionImageID("devbox"),
			teamextensionimagearchive.Arch("x86_64"),
		).
		Only(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if updatedArchive.Version != "1.1.0" || updatedArchive.ArchivePath != "static/extensions/devbox-v2.tar.gz" || updatedArchive.Sha256 != "sha256-second" {
		t.Fatalf("updated archive = %#v", updatedArchive)
	}
}

func TestTeamExtensionPackageRepoImportResourcesRejectsImageNameOwnedByAnotherPackage(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	createTeamRepoDefaultGroup(t, client, teamID)
	repo := &teamExtensionPackageRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if _, err := repo.ImportResources(ctx, teamID, userID, &domain.TeamExtensionImport{
		PackageID: "pack-a",
		Version:   "1.0.0",
		Images: []domain.TeamExtensionImageImport{{
			ImageID: "devbox-a",
			Name:    "repo/devbox:1",
			Archives: []domain.TeamExtensionImageArchiveImport{{
				Arch:        "x86_64",
				ArchivePath: "static/extensions/a.tar.gz",
				ArchiveURL:  "/static/extensions/a.tar.gz",
			}},
		}},
	}); err != nil {
		t.Fatal(err)
	}

	_, err := repo.ImportResources(ctx, teamID, userID, &domain.TeamExtensionImport{
		PackageID: "pack-b",
		Version:   "1.0.0",
		Images: []domain.TeamExtensionImageImport{{
			ImageID: "devbox-b",
			Name:    "repo/devbox:1",
			Archives: []domain.TeamExtensionImageArchiveImport{{
				Arch:        "x86_64",
				ArchivePath: "static/extensions/b.tar.gz",
				ArchiveURL:  "/static/extensions/b.tar.gz",
			}},
		}},
	})
	if err == nil {
		t.Fatal("expected image name conflict")
	}
}
