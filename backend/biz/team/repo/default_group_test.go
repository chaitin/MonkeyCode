package repo

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/patrickmn/go-cache"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/teamgrouphost"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupimage"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmodel"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupskill"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestTeamImageCreateUsesDefaultGroupWhenGroupIDsEmpty(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	group := createTeamRepoDefaultGroup(t, client, teamID)
	repo := &teamImageRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	img, err := repo.Create(ctx, teamID, userID, &domain.AddTeamImageReq{
		Name:   "devbox:latest",
		Remark: "devbox",
	})
	if err != nil {
		t.Fatal(err)
	}

	exists, err := client.TeamGroupImage.Query().
		Where(teamgroupimage.GroupIDEQ(group.ID), teamgroupimage.ImageIDEQ(img.ID)).
		Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("image was not added to default group")
	}
}

func TestTeamImageCreateKeepsExplicitGroup(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	defaultGroup := createTeamRepoDefaultGroup(t, client, teamID)
	customGroup := createTeamRepoGroup(t, client, teamID, "自定义分组")
	repo := &teamImageRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	img, err := repo.Create(ctx, teamID, userID, &domain.AddTeamImageReq{
		Name:     "custom-devbox:latest",
		GroupIDs: []uuid.UUID{customGroup.ID},
	})
	if err != nil {
		t.Fatal(err)
	}

	if exists := teamRepoImageInGroup(t, client, customGroup.ID, img.ID); !exists {
		t.Fatal("image was not added to explicit group")
	}
	if exists := teamRepoImageInGroup(t, client, defaultGroup.ID, img.ID); exists {
		t.Fatal("image was added to default group despite explicit group")
	}
}

func TestTeamModelCreateUsesDefaultGroupWhenGroupIDsEmpty(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	group := createTeamRepoDefaultGroup(t, client, teamID)
	repo := &teamModelRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	model, err := repo.Create(ctx, teamID, userID, &domain.AddTeamModelReq{
		Provider:      "openai",
		APIKey:        "sk-test",
		BaseURL:       "https://example.com/v1",
		Model:         "gpt-test",
		InterfaceType: consts.InterfaceTypeOpenAIChat,
	})
	if err != nil {
		t.Fatal(err)
	}

	exists, err := client.TeamGroupModel.Query().
		Where(teamgroupmodel.GroupIDEQ(group.ID), teamgroupmodel.ModelIDEQ(model.ID)).
		Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("model was not added to default group")
	}
}

func TestTeamModelCreateKeepsExplicitGroup(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	defaultGroup := createTeamRepoDefaultGroup(t, client, teamID)
	customGroup := createTeamRepoGroup(t, client, teamID, "模型分组")
	repo := &teamModelRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	model, err := repo.Create(ctx, teamID, userID, &domain.AddTeamModelReq{
		Provider:      "openai",
		APIKey:        "sk-test",
		BaseURL:       "https://example.com/v1",
		Model:         "gpt-custom",
		GroupIDs:      []uuid.UUID{customGroup.ID},
		InterfaceType: consts.InterfaceTypeOpenAIChat,
	})
	if err != nil {
		t.Fatal(err)
	}

	if exists := teamRepoModelInGroup(t, client, customGroup.ID, model.ID); !exists {
		t.Fatal("model was not added to explicit group")
	}
	if exists := teamRepoModelInGroup(t, client, defaultGroup.ID, model.ID); exists {
		t.Fatal("model was added to default group despite explicit group")
	}
}

func TestTeamHostUpsertUsesDefaultGroupForNewHost(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	group := createTeamRepoDefaultGroup(t, client, teamID)
	repo := &TeamHostRepo{
		db:     client,
		cache:  cache.New(15*time.Minute, 10*time.Minute),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	err := repo.UpsertHost(ctx, &domain.User{
		ID: userID,
		Team: &domain.Team{
			ID:   teamID,
			Name: "team",
		},
	}, &taskflow.Host{
		ID:       "host-default-group",
		UserID:   userID.String(),
		Hostname: "host",
		Arch:     "amd64",
		OS:       "linux",
		Cores:    8,
		Memory:   16 * 1024,
	})
	if err != nil {
		t.Fatal(err)
	}

	exists, err := client.TeamGroupHost.Query().
		Where(teamgrouphost.GroupIDEQ(group.ID), teamgrouphost.HostIDEQ("host-default-group")).
		Exist(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("host was not added to default group")
	}
}

func TestTeamSkillCreateUsesDefaultGroupWhenGroupIDsEmpty(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	group := createTeamRepoDefaultGroup(t, client, teamID)
	repo := &teamSkillRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	skill, err := repo.Create(ctx, teamID, userID, &domain.AddTeamSkillReq{
		Name:        "code-review",
		Description: "Review code changes",
		Content:     "---\nname: code-review\ndescription: Review code changes\n---\n",
		Tags:        []string{"review", "go"},
		SourceType:  "markdown",
		SourceLabel: "SKILL.md",
	})
	if err != nil {
		t.Fatal(err)
	}

	if exists := teamRepoSkillInGroup(t, client, group.ID, skill.ID); !exists {
		t.Fatal("skill was not added to default group")
	}
}

func TestTeamSkillCreateKeepsExplicitGroup(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	defaultGroup := createTeamRepoDefaultGroup(t, client, teamID)
	customGroup := createTeamRepoGroup(t, client, teamID, "Skill 分组")
	repo := &teamSkillRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	skill, err := repo.Create(ctx, teamID, userID, &domain.AddTeamSkillReq{
		Name:        "frontend-polish",
		Description: "Polish frontend UX",
		Content:     "---\nname: frontend-polish\ndescription: Polish frontend UX\n---\n",
		GroupIDs:    []uuid.UUID{customGroup.ID},
		SourceType:  "markdown",
		SourceLabel: "SKILL.md",
	})
	if err != nil {
		t.Fatal(err)
	}

	if exists := teamRepoSkillInGroup(t, client, customGroup.ID, skill.ID); !exists {
		t.Fatal("skill was not added to explicit group")
	}
	if exists := teamRepoSkillInGroup(t, client, defaultGroup.ID, skill.ID); exists {
		t.Fatal("skill was added to default group despite explicit group")
	}
}

func TestTeamSkillUpdateReplacesGroups(t *testing.T) {
	ctx := context.Background()
	client := newTeamRepoTestDB(t)
	teamID := createTeamRepoTestTeam(t, client)
	userID := createTeamRepoTestUser(t, client)
	oldGroup := createTeamRepoGroup(t, client, teamID, "旧分组")
	newGroup := createTeamRepoGroup(t, client, teamID, "新分组")
	repo := &teamSkillRepo{
		db:     client,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	skill, err := repo.Create(ctx, teamID, userID, &domain.AddTeamSkillReq{
		Name:        "plan-writer",
		Description: "Write plans",
		Content:     "---\nname: plan-writer\ndescription: Write plans\n---\n",
		GroupIDs:    []uuid.UUID{oldGroup.ID},
		SourceType:  "markdown",
		SourceLabel: "SKILL.md",
	})
	if err != nil {
		t.Fatal(err)
	}

	updated, err := repo.Update(ctx, teamID, &domain.UpdateTeamSkillReq{
		SkillID:     skill.ID,
		Name:        "plan-writer-v2",
		Description: "Write implementation plans",
		Tags:        []string{"planning"},
		GroupIDs:    []uuid.UUID{newGroup.ID},
	})
	if err != nil {
		t.Fatal(err)
	}

	if updated.Name != "plan-writer-v2" {
		t.Fatalf("skill name = %q, want plan-writer-v2", updated.Name)
	}
	if exists := teamRepoSkillInGroup(t, client, oldGroup.ID, skill.ID); exists {
		t.Fatal("skill still belongs to old group")
	}
	if exists := teamRepoSkillInGroup(t, client, newGroup.ID, skill.ID); !exists {
		t.Fatal("skill was not added to new group")
	}
}

func createTeamRepoTestUser(t *testing.T, client *db.Client) uuid.UUID {
	t.Helper()
	userID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("member").
		SetEmail(userID.String() + "@example.com").
		SetPassword("hashed").
		SetRole(consts.UserRoleSubAccount).
		SetStatus(consts.UserStatusActive).
		Save(context.Background()); err != nil {
		t.Fatal(err)
	}
	return userID
}

func createTeamRepoDefaultGroup(t *testing.T, client *db.Client, teamID uuid.UUID) *db.TeamGroup {
	t.Helper()
	return createTeamRepoGroup(t, client, teamID, defaultTeamGroupName)
}

func createTeamRepoGroup(t *testing.T, client *db.Client, teamID uuid.UUID, name string) *db.TeamGroup {
	t.Helper()
	group, err := client.TeamGroup.Create().
		SetID(uuid.New()).
		SetTeamID(teamID).
		SetName(name).
		Save(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return group
}

func teamRepoImageInGroup(t *testing.T, client *db.Client, groupID, imageID uuid.UUID) bool {
	t.Helper()
	exists, err := client.TeamGroupImage.Query().
		Where(teamgroupimage.GroupIDEQ(groupID), teamgroupimage.ImageIDEQ(imageID)).
		Exist(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return exists
}

func teamRepoModelInGroup(t *testing.T, client *db.Client, groupID, modelID uuid.UUID) bool {
	t.Helper()
	exists, err := client.TeamGroupModel.Query().
		Where(teamgroupmodel.GroupIDEQ(groupID), teamgroupmodel.ModelIDEQ(modelID)).
		Exist(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return exists
}

func teamRepoSkillInGroup(t *testing.T, client *db.Client, groupID, skillID uuid.UUID) bool {
	t.Helper()
	exists, err := client.TeamGroupSkill.Query().
		Where(teamgroupskill.GroupIDEQ(groupID), teamgroupskill.SkillIDEQ(skillID)).
		Exist(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return exists
}
