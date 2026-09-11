package usecase

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/aiguard"
	"github.com/chaitin/MonkeyCode/backend/pkg/auditmeta"
)

func TestTeamSkillUsecaseAddPackageScansOnceAndRecordsAuditMetadata(t *testing.T) {
	packageData, err := packageSkillMarkdownContent("---\nname: guarded-skill\ndescription: guarded\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	guard := &skillGuardStub{
		result: &domain.SkillGuardResult{
			TaskID:          "task-rejected",
			Status:          "completed",
			DetectionResult: "high",
			TraceID:         "trace-1",
		},
		err: aiguard.ErrRejected,
	}
	collector := &auditmeta.Collector{}
	ctx := auditmeta.WithCollector(context.Background(), collector)
	u := &teamSkillUsecase{guard: guard}

	_, err = u.AddPackage(ctx, &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "guarded-skill", Description: "guarded"},
		PackageFilename: "guarded-skill.zip",
		PackageData:     packageData,
	})
	if !errors.Is(err, aiguard.ErrRejected) {
		t.Fatalf("AddPackage() error = %v, want ErrRejected", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
	result, ok := collector.GuardResult()
	if !ok {
		t.Fatal("audit guard result was not recorded")
	}
	if result.TaskID != "task-rejected" || result.Status != "completed" || result.DetectionResult != "high" || result.TraceID != "trace-1" {
		t.Fatalf("audit guard result = %#v", result)
	}
}

func TestTeamSkillUsecaseAddPackageDoesNotWriteWhenGuardIsUnavailable(t *testing.T) {
	packageData, err := packageSkillMarkdownContent("---\nname: guarded-skill\ndescription: guarded\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	guard := &skillGuardStub{err: aiguard.ErrNotConfigured}
	u := &teamSkillUsecase{guard: guard}

	_, err = u.AddPackage(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "guarded-skill", Description: "guarded"},
		PackageFilename: "guarded-skill.zip",
		PackageData:     packageData,
	})
	if !errors.Is(err, aiguard.ErrNotConfigured) {
		t.Fatalf("AddPackage() error = %v, want ErrNotConfigured", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
}

func TestTeamSkillUsecaseContentUpdateUsesGuard(t *testing.T) {
	skillID := uuid.New()
	teamID := uuid.New()
	guard := &skillGuardStub{err: aiguard.ErrRejected}
	repo := &teamSkillRepoStub{skills: []*db.AgentSkill{{ID: skillID, Name: "existing-skill", Description: "existing"}}}
	u := &teamSkillUsecase{repo: repo, guard: guard}

	_, err := u.Update(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: teamID},
	}, &domain.UpdateTeamSkillReq{SkillID: skillID, Content: "---\nname: existing-skill\ndescription: existing\n---\nnew body\n"})
	if !errors.Is(err, aiguard.ErrRejected) {
		t.Fatalf("Update() error = %v, want ErrRejected", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
	if repo.updateMetaCalled {
		t.Fatal("content update unexpectedly wrote metadata before the scan")
	}
}

func TestTeamSkillUsecaseMetadataOnlyUpdateSkipsGuard(t *testing.T) {
	skillID := uuid.New()
	description := "new description"
	guard := &skillGuardStub{err: errors.New("guard must not be called")}
	repo := &teamSkillRepoStub{skills: []*db.AgentSkill{{ID: skillID, Name: "existing-skill", Description: "existing"}}}
	u := &teamSkillUsecase{repo: repo, guard: guard}

	if _, err := u.Update(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.UpdateTeamSkillReq{SkillID: skillID, Description: &description}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if guard.calls != 0 {
		t.Fatalf("guard calls = %d, want 0", guard.calls)
	}
	if !repo.updateMetaCalled {
		t.Fatal("metadata update was not written")
	}
}

func TestTeamExtensionPackageImportScansWholePackageOnce(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	guard := &skillGuardStub{result: &domain.SkillGuardResult{
		TaskID:          "task-safe",
		Status:          "completed",
		DetectionResult: "safe",
	}}
	skills := &teamSkillUsecaseStub{}
	u := &teamExtensionPackageUsecase{
		repo:              &extensionPackageRepoStub{},
		skillUsecase:      skills,
		guard:             guard,
		ruleImporter:      &extensionPackageRuleImporterStub{},
		staticDir:         t.TempDir(),
		staticRoutePrefix: "/static",
	}
	data := makeExtensionZip(t, map[string]string{
		"manifest.json":     `{"package_id":"pack","version":"1.0.0","skills":[{"skill_id":"a","path":"skills/a/SKILL.md"},{"skill_id":"b","path":"skills/b/SKILL.md"}]}`,
		"skills/a/SKILL.md": "---\nname: skill-a\ndescription: A\n---\nbody-a\n",
		"skills/b/SKILL.md": "---\nname: skill-b\ndescription: B\n---\nbody-b\n",
	})

	_, err := u.Import(ctx, &domain.TeamUser{
		User: &domain.User{ID: userID},
		Team: &domain.Team{ID: teamID},
	}, &domain.ImportTeamExtensionPackageReq{Filename: "pack.zip", Data: data})
	if err != nil {
		t.Fatalf("Import() error = %v", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
	if !bytes.Equal(guard.lastRequest.Package, data) {
		t.Fatal("scanner did not receive the original extension package")
	}
	if len(skills.adds) != 2 {
		t.Fatalf("skill adds = %d, want 2", len(skills.adds))
	}
	for i, req := range skills.adds {
		if !req.GuardChecked {
			t.Fatalf("skill add %d did not bypass the per-Skill scan", i)
		}
	}
}

type skillGuardStub struct {
	calls       int
	lastRequest domain.SkillGuardRequest
	result      *domain.SkillGuardResult
	err         error
}

func (s *skillGuardStub) Scan(_ context.Context, req domain.SkillGuardRequest) (*domain.SkillGuardResult, error) {
	s.calls++
	s.lastRequest = req
	return s.result, s.err
}

type teamSkillUsecaseStub struct {
	adds []*domain.AddTeamSkillReq
}

func (s *teamSkillUsecaseStub) List(context.Context, *domain.TeamUser) (*domain.ListTeamSkillsResp, error) {
	return &domain.ListTeamSkillsResp{}, nil
}

func (s *teamSkillUsecaseStub) Add(_ context.Context, _ *domain.TeamUser, req *domain.AddTeamSkillReq) (*domain.TeamSkill, error) {
	s.adds = append(s.adds, req)
	return &domain.TeamSkill{}, nil
}

func (s *teamSkillUsecaseStub) AddPackage(context.Context, *domain.TeamUser, *domain.AddTeamSkillPackageReq) (*domain.TeamSkill, error) {
	return &domain.TeamSkill{}, nil
}

func (s *teamSkillUsecaseStub) Update(context.Context, *domain.TeamUser, *domain.UpdateTeamSkillReq) (*domain.TeamSkill, error) {
	return &domain.TeamSkill{}, nil
}

func (s *teamSkillUsecaseStub) Delete(context.Context, *domain.TeamUser, *domain.DeleteTeamSkillReq) error {
	return nil
}

var _ domain.SkillGuard = (*skillGuardStub)(nil)
var _ domain.TeamSkillUsecase = (*teamSkillUsecaseStub)(nil)

type teamSkillRepoStub struct {
	skills           []*db.AgentSkill
	updateMetaCalled bool
}

func (s *teamSkillRepoStub) List(context.Context, uuid.UUID) ([]*db.AgentSkill, error) {
	return s.skills, nil
}

func (s *teamSkillRepoStub) GetSkill(_ context.Context, _, skillID uuid.UUID) (*db.AgentSkill, error) {
	for _, skill := range s.skills {
		if skill.ID == skillID {
			return skill, nil
		}
	}
	return &db.AgentSkill{ID: skillID, Name: "existing-skill", Description: "existing"}, nil
}

func (s *teamSkillRepoStub) GetBareRepoID(context.Context, uuid.UUID) (uuid.UUID, error) {
	return uuid.New(), nil
}

func (s *teamSkillRepoStub) UpsertSkill(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, string, bool, string) (*db.AgentSkill, error) {
	return &db.AgentSkill{}, nil
}

func (s *teamSkillRepoStub) CreateVersion(context.Context, uuid.UUID, string, string, domain.SkillVersionMeta) (*db.AgentSkillVersion, error) {
	return &db.AgentSkillVersion{}, nil
}

func (s *teamSkillRepoStub) UpdateMeta(context.Context, uuid.UUID, uuid.UUID, string, *string, *bool) (*db.AgentSkill, error) {
	s.updateMetaCalled = true
	return &db.AgentSkill{}, nil
}

func (s *teamSkillRepoStub) UpdateActiveVersionTags(context.Context, uuid.UUID, []string) error {
	return nil
}

func (s *teamSkillRepoStub) SoftDeleteSkill(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}

func (s *teamSkillRepoStub) ReplaceGroupBindings(context.Context, uuid.UUID, uuid.UUID, []uuid.UUID) error {
	return nil
}

func (s *teamSkillRepoStub) GetActiveVersion(context.Context, uuid.UUID) (*db.AgentSkillVersion, error) {
	return nil, nil
}

func (s *teamSkillRepoStub) NextVersionFor(context.Context, uuid.UUID) (string, error) {
	return "v1", nil
}

func (s *teamSkillRepoStub) LoadGroups(context.Context, uuid.UUID) ([]domain.SkillGroupRef, error) {
	return nil, nil
}

var _ domain.TeamSkillRepo = (*teamSkillRepoStub)(nil)
