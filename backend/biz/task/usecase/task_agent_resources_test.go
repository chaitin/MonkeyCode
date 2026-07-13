package usecase

import (
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestFillAgentResourceBaseline_NilExtra(t *testing.T) {
	tk := &domain.Task{Extra: nil}
	skillIDs := []string{"skill-a", "skill-b"}
	pluginIDs := []string{"plugin-x"}

	fillAgentResourceBaseline(tk, skillIDs, pluginIDs)

	if tk.Extra == nil {
		t.Fatal("fillAgentResourceBaseline() Extra is nil, want initialized")
	}
	if len(tk.Extra.SkillIDs) != 2 || tk.Extra.SkillIDs[0] != "skill-a" || tk.Extra.SkillIDs[1] != "skill-b" {
		t.Fatalf("SkillIDs = %v, want [skill-a skill-b]", tk.Extra.SkillIDs)
	}
	if len(tk.Extra.PluginIDs) != 1 || tk.Extra.PluginIDs[0] != "plugin-x" {
		t.Fatalf("PluginIDs = %v, want [plugin-x]", tk.Extra.PluginIDs)
	}
}

func TestFillAgentResourceBaseline_PreservesExisting(t *testing.T) {
	projectID := uuid.New()
	tk := &domain.Task{
		Extra: &domain.TaskExtraConfig{
			ProjectID: projectID,
		},
	}
	skillIDs := []string{"skill-1"}
	pluginIDs := []string{"plugin-1", "plugin-2"}

	fillAgentResourceBaseline(tk, skillIDs, pluginIDs)

	if tk.Extra.ProjectID != projectID {
		t.Fatalf("ProjectID = %v, want %v (preserved)", tk.Extra.ProjectID, projectID)
	}
	if len(tk.Extra.SkillIDs) != 1 || tk.Extra.SkillIDs[0] != "skill-1" {
		t.Fatalf("SkillIDs = %v, want [skill-1]", tk.Extra.SkillIDs)
	}
	if len(tk.Extra.PluginIDs) != 2 {
		t.Fatalf("PluginIDs = %v, want [plugin-1 plugin-2]", tk.Extra.PluginIDs)
	}
}

func TestFillAgentResourceBaseline_EmptySlices(t *testing.T) {
	tk := &domain.Task{Extra: nil}

	// should not panic
	fillAgentResourceBaseline(tk, nil, nil)

	if tk.Extra == nil {
		t.Fatal("fillAgentResourceBaseline() Extra is nil, want initialized")
	}
	if tk.Extra.SkillIDs != nil {
		t.Fatalf("SkillIDs = %v, want nil", tk.Extra.SkillIDs)
	}
	if tk.Extra.PluginIDs != nil {
		t.Fatalf("PluginIDs = %v, want nil", tk.Extra.PluginIDs)
	}
}

func TestNormalizeAgentResources_NilBecomesEmpty(t *testing.T) {
	got := normalizeAgentResources(nil)
	if got == nil {
		t.Fatal("normalizeAgentResources(nil) returned nil, want non-nil empty struct")
	}
	if got.Skills != nil {
		t.Fatalf("Skills = %v, want nil (empty)", got.Skills)
	}
	if got.Plugins != nil {
		t.Fatalf("Plugins = %v, want nil (empty)", got.Plugins)
	}
}

func TestNormalizeAgentResources_PassThrough(t *testing.T) {
	input := &taskflow.AgentResources{
		Skills: []*taskflow.AgentResourceAssetRef{
			{Name: "skill-a"},
		},
	}
	got := normalizeAgentResources(input)
	if got != input {
		t.Fatal("normalizeAgentResources() with non-nil input returned different pointer, want same pointer")
	}
}
