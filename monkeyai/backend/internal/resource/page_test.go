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
