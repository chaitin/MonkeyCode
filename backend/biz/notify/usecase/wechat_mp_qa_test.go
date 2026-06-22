package usecase

import "testing"

func TestTruncateRunes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		max  int
		want string
	}{
		{"short", "hello", 10, "hello"},
		{"boundary", "abc", 3, "abc"},
		{"truncate cjk", "一二三四五", 3, "一二三…"},
		{"empty", "", 5, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := truncateRunes(c.in, c.max); got != c.want {
				t.Errorf("truncateRunes(%q, %d) = %q, want %q", c.in, c.max, got, c.want)
			}
		})
	}
}
