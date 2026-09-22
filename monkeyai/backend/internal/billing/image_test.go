package billing

import "testing"

func TestPriceImages(t *testing.T) {
	unit, err := ParseAmount("12.500001")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		count int64
		want  string
	}{
		{0, "0"},
		{1, "12.500001"},
		{3, "37.500003"},
	} {
		amount, err := priceImages(unit, tc.count)
		if err != nil || amount.String() != tc.want {
			t.Fatalf("priceImages(%d) = %s, %v; want %s", tc.count, amount, err, tc.want)
		}
	}
	for _, tc := range []struct {
		price Amount
		count int64
	}{
		{-1, 1},
		{unit, -1},
		{unit, 1 << 60},
	} {
		if _, err := priceImages(tc.price, tc.count); err == nil {
			t.Fatalf("priceImages(%d, %d) 应拒绝非法金额", tc.price, tc.count)
		}
	}
}
