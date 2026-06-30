package domain

import (
	"reflect"
	"testing"
)

func repos(names ...string) []AuthRepository {
	out := make([]AuthRepository, 0, len(names))
	for _, n := range names {
		out = append(out, AuthRepository{FullName: n})
	}
	return out
}

func fullNames(rs []AuthRepository) []string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, r.FullName)
	}
	return out
}

func TestPaginateRepos(t *testing.T) {
	all := repos("o/a", "o/Beta", "o/c", "o/beta2", "o/e")

	cases := []struct {
		name        string
		all         []AuthRepository
		keyword     string
		page        int
		size        int
		wantNames   []string
		wantTotal   int64
		wantHasNext bool
	}{
		{
			name:        "first page",
			all:         all,
			page:        1,
			size:        2,
			wantNames:   []string{"o/a", "o/Beta"},
			wantTotal:   5,
			wantHasNext: true,
		},
		{
			name:        "middle page",
			all:         all,
			page:        2,
			size:        2,
			wantNames:   []string{"o/c", "o/beta2"},
			wantTotal:   5,
			wantHasNext: true,
		},
		{
			name:        "last partial page no next",
			all:         all,
			page:        3,
			size:        2,
			wantNames:   []string{"o/e"},
			wantTotal:   5,
			wantHasNext: false,
		},
		{
			name:        "page beyond range",
			all:         all,
			page:        4,
			size:        2,
			wantNames:   []string{},
			wantTotal:   5,
			wantHasNext: false,
		},
		{
			name:        "size larger than total",
			all:         all,
			page:        1,
			size:        10,
			wantNames:   []string{"o/a", "o/Beta", "o/c", "o/beta2", "o/e"},
			wantTotal:   5,
			wantHasNext: false,
		},
		{
			name:        "keyword case insensitive filter then paginate",
			all:         all,
			keyword:     "BETA",
			page:        1,
			size:        1,
			wantNames:   []string{"o/Beta"},
			wantTotal:   2, // o/Beta, o/beta2
			wantHasNext: true,
		},
		{
			name:        "keyword second page",
			all:         all,
			keyword:     "beta",
			page:        2,
			size:        1,
			wantNames:   []string{"o/beta2"},
			wantTotal:   2,
			wantHasNext: false,
		},
		{
			name:        "keyword no match",
			all:         all,
			keyword:     "zzz",
			page:        1,
			size:        10,
			wantNames:   []string{},
			wantTotal:   0,
			wantHasNext: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := PaginateRepos(tc.all, tc.keyword, tc.page, tc.size)
			if got.PageInfo == nil {
				t.Fatalf("PageInfo is nil")
			}
			if names := fullNames(got.Repositories); !reflect.DeepEqual(names, tc.wantNames) {
				t.Errorf("names = %v, want %v", names, tc.wantNames)
			}
			if got.PageInfo.TotalCount != tc.wantTotal {
				t.Errorf("total = %d, want %d", got.PageInfo.TotalCount, tc.wantTotal)
			}
			if got.PageInfo.HasNextPage != tc.wantHasNext {
				t.Errorf("hasNext = %v, want %v", got.PageInfo.HasNextPage, tc.wantHasNext)
			}
		})
	}
}
