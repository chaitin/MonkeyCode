package model

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestModelTagInput(t *testing.T) {
	input := validInput()
	input.TagIDs = []string{"tag-1"}
	item, err := NewService(&repositoryStub{}).Create(t.Context(), "admin-1", input)
	if err != nil || len(item.TagIDs) != 1 || item.TagIDs[0] != "tag-1" {
		t.Fatalf("model tag IDs = %v, err = %v", item.TagIDs, err)
	}
}

func TestFilterModelTags(t *testing.T) {
	items := []AgentModel{
		{ID: "one", Tags: []resource.Object{{"id": "tag-1", "name": "Tools"}}},
		{ID: "two", Tags: []resource.Object{{"id": "tag-2", "name": "Models"}}},
		{ID: "three", Tags: []resource.Object{}},
		{ID: "both", Tags: []resource.Object{{"id": "tag-1"}, {"id": "tag-2"}}},
	}
	if got := filterModelTags(items, []string{"tag-1"}); len(got) != 2 || got[0].ID != "one" || got[1].ID != "both" {
		t.Fatalf("tagged models: %v", got)
	}
	if got := filterModelTags(items, []string{"tag-1", "tag-2"}); len(got) != 3 || got[0].ID != "one" || got[1].ID != "two" || got[2].ID != "both" {
		t.Fatalf("multi-tag models: %v", got)
	}
	if got := filterModelTags(items, []string{"missing"}); len(got) != 0 {
		t.Fatalf("unexpected models: %v", got)
	}
	if got := filterModelTags(items, nil); len(got) != 4 {
		t.Fatalf("unfiltered models: %v", got)
	}
}
