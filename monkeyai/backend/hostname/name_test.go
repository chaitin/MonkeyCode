package hostname

import (
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	for _, tc := range []struct {
		raw, want string
		ok        bool
	}{
		{"\t\n\u00a0\u3000\ufeff", "", true}, {"\ufeff 节点\t", "节点", true}, {"\u0085", "\u0085", true},
		{strings.Repeat("🙂", 32), strings.Repeat("🙂", 32), true}, {strings.Repeat("🙂", 32) + "a", "", false},
		{strings.Repeat("中", 43), "", false}, {"a\nb", "", false},
	} {
		got, ok := Normalize(tc.raw)
		if ok != tc.ok || ok && got != tc.want || Candidate(tc.raw) != tc.want {
			t.Fatalf("名称 %q: %q, %v", tc.raw, got, ok)
		}
	}
}
