package resource

import (
	"net/http/httptest"
	"slices"
	"testing"
)

func TestPageParamsAndSlice(t *testing.T) {
	for _, tc := range []struct {
		query             string
		page, size, count int
		invalid           bool
	}{
		{"", 1, 20, 3, false},
		{"?page=2&page_size=2", 2, 2, 1, false},
		{"?page=99&page_size=2", 99, 2, 0, false},
		{"?page=0", 0, 0, 0, true},
		{"?page_size=101", 0, 0, 0, true},
	} {
		r := httptest.NewRequest("GET", "/models"+tc.query, nil)
		page, size, err := PageParams(r)
		if (err != nil) != tc.invalid {
			t.Fatalf("%s: err = %v", tc.query, err)
		}
		if tc.invalid {
			continue
		}
		got := PageSlice([]int{1, 2, 3}, page, size)
		if page != tc.page || size != tc.size || len(got) != tc.count {
			t.Fatalf("%s: page=%d size=%d items=%v", tc.query, page, size, got)
		}
	}
}

func TestQueryTagIDs(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"", nil},
		{"?tag_id=old", []string{"old"}},
		{"?tag_ids=a&tag_ids=b", []string{"a", "b"}},
		{"?tag_ids=a,b&tag_id=old&tag_ids=b", []string{"old", "a", "b"}},
		{"?tag_ids=%20a%20,%20b%20&tag_ids=", []string{"a", "b"}},
	} {
		r := httptest.NewRequest("GET", "/models"+tc.query, nil)
		got := QueryTagIDs(r)
		if !slices.Equal(got, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.query, got, tc.want)
		}
	}
}

func TestTagFilteringAndCollection(t *testing.T) {
	items := []Object{
		{"id": "a", "tags": []Object{{"id": "2", "name": "Z"}, {"id": "1", "name": "a"}}},
		{"id": "b", "tags": []Object{{"id": "1", "name": "a"}}},
		{"id": "c", "tags": []Object{}},
	}
	if got := FilterTags(items, []string{"2"}); len(got) != 1 || got[0].String("id") != "a" {
		t.Fatalf("filtered items: %v", got)
	}
	if got := FilterTags(items, []string{"1", "2"}); len(got) != 2 || got[0].String("id") != "a" || got[1].String("id") != "b" {
		t.Fatalf("multi-tag filtered items: %v", got)
	}
	if got := FilterTags(items, nil); len(got) != 3 {
		t.Fatalf("unfiltered items: %v", got)
	}
	if got := CollectTags(items); len(got) != 2 || got[0].String("id") != "1" || got[1].String("id") != "2" {
		t.Fatalf("tags: %v", got)
	}
	if got := FilterTags([]Object{{"id": "rule"}}, []string{"2"}); len(got) != 0 {
		t.Fatalf("unexpected untagged item: %v", got)
	}
}
