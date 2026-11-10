package resource

import (
	"fmt"
	"net/http/httptest"
	"testing"
)

func TestPageParamsWithLimit(t *testing.T) {
	for _, size := range []int{20, 50, 100, 200, 500} {
		r := httptest.NewRequest("GET", fmt.Sprintf("/?page=2&page_size=%d", size), nil)
		page, actual, err := PageParamsWithLimit(r, 500)
		if err != nil || page != 2 || actual != size {
			t.Fatalf("size=%d: page=%d size=%d err=%v", size, page, actual, err)
		}
	}
	for _, query := range []string{"page_size=0", "page_size=501", "page_size=bad", "page=1000001"} {
		if _, _, err := PageParamsWithLimit(httptest.NewRequest("GET", "/?"+query, nil), 500); err == nil {
			t.Fatalf("应拒绝无效分页: %s", query)
		}
	}
}

func TestPageValuesWithLimit(t *testing.T) {
	page, size, err := PageValuesWithLimit(2, 50, 100)
	if err != nil || page != 2 || size != 50 {
		t.Fatalf("page=%d size=%d err=%v", page, size, err)
	}
	for _, tc := range []struct {
		page, size, max int
	}{
		{page: 0, size: 20, max: 100},
		{page: 1, size: 0, max: 100},
		{page: 1, size: 101, max: 100},
		{page: 1000001, size: 20, max: 100},
	} {
		if _, _, err := PageValuesWithLimit(tc.page, tc.size, tc.max); err == nil {
			t.Fatalf("应拒绝无效分页: page=%d size=%d max=%d", tc.page, tc.size, tc.max)
		}
	}
}
