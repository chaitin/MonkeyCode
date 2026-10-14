package billing

import "testing"

func TestQuoteVideoMilliseconds(t *testing.T) {
	rate, err := ParseAmount("14")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		ms   int64
		want string
	}{
		{6000, "84"},
		{15000, "210"},
		{30000, "420"},
		{25125, "351.75"},
		{1250, "17.5"},
		{1, "0.014"},
	} {
		got, err := QuoteVideo(rate, tc.ms)
		if err != nil || got.String() != tc.want {
			t.Fatalf("时长 %d: got %s, err %v; want %s", tc.ms, got, err, tc.want)
		}
	}
	for _, duration := range []int64{-1, 30001} {
		if _, err := QuoteVideo(rate, duration); err == nil {
			t.Fatalf("必须拒绝超出范围的时长 %d", duration)
		}
	}
}
