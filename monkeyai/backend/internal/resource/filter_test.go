package resource

import (
	"net/http/httptest"
	"testing"
)

func TestParseCatalogFilter(t *testing.T) {
	for _, tc := range []struct {
		query, search, owner string
		invalid              bool
	}{
		{"", "", "all", false},
		{"?q=%20TeSt%20&owner=team", "test", "team", false},
		{"?owner=mine", "", "mine", false},
		{"?owner=shared", "", "shared", false},
		{"?owner=unknown", "", "", true},
	} {
		f, err := ParseCatalogFilter(httptest.NewRequest("GET", "/skills"+tc.query, nil))
		if (err != nil) != tc.invalid || (!tc.invalid && (f.Query != tc.search || f.Owner != tc.owner)) {
			t.Fatalf("%s: filter=%+v err=%v", tc.query, f, err)
		}
	}
}

func TestCatalogFilterMatches(t *testing.T) {
	items := []struct {
		ownership, ownerID, name, description string
	}{
		{"system", "admin", "Search Model", ""},
		{"user", "me", "My Skill", "Builds Go services"},
		{"user", "other", "Shared Skill", "Writes tests"},
	}
	for _, tc := range []struct {
		owner, query string
		want         []bool
	}{
		{"all", "", []bool{true, true, true}},
		{"team", "", []bool{true, false, false}},
		{"mine", "", []bool{false, true, false}},
		{"shared", "", []bool{false, false, true}},
		{"all", "SKILL", []bool{false, true, true}},
		{"mine", "go", []bool{false, true, false}},
		{"shared", "GO", []bool{false, false, false}},
	} {
		f := CatalogFilter{Query: tc.query, Owner: tc.owner}
		for i, item := range items {
			if got := f.Matches(item.ownership, item.ownerID, "me", item.name, item.description); got != tc.want[i] {
				t.Errorf("owner=%s query=%s item=%d: got %v, want %v", tc.owner, tc.query, i, got, tc.want[i])
			}
		}
	}
	if (CatalogFilter{Owner: "shared"}).Matches("user", "", "", "Missing", "") {
		t.Fatal("empty owner/user should not match shared resources")
	}
}
