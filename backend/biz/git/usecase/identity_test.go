package usecase

import "testing"

func TestNormalizeRepoPageSize(t *testing.T) {
	cases := []struct {
		in   int
		want int
	}{
		{in: 0, want: defaultRepoPageSize},
		{in: -5, want: defaultRepoPageSize},
		{in: 1, want: 1},
		{in: 20, want: 20},
		{in: 100, want: 100},
		{in: 101, want: maxRepoPageSize},
		{in: 1000, want: maxRepoPageSize},
	}
	for _, tc := range cases {
		if got := normalizeRepoPageSize(tc.in); got != tc.want {
			t.Errorf("normalizeRepoPageSize(%d) = %d, want %d", tc.in, got, tc.want)
		}
	}
}
