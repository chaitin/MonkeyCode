package videoproxy

import "testing"

func TestParseRange(t *testing.T) {
	for _, tc := range []struct {
		header       string
		start, end   int64
		partial, bad bool
	}{
		{"", 0, 99, false, false},
		{"bytes=10-19", 10, 19, true, false},
		{"bytes=90-", 90, 99, true, false},
		{"bytes=-10", 90, 99, true, false},
		{"bytes=100-", 0, 0, false, true},
		{"bytes=1-2,3-4", 0, 0, false, true},
	} {
		start, end, partial, err := parseRange(tc.header, 100)
		if start != tc.start || end != tc.end || partial != tc.partial || (err != nil) != tc.bad {
			t.Fatalf("%s: %d-%d, %t, %v", tc.header, start, end, partial, err)
		}
	}
}
