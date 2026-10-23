package billing

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestPageSizeOptions(t *testing.T) {
	for _, size := range []int{20, 50, 100, 200, 500} {
		page, actual := pageParams(httptest.NewRequest("GET", fmt.Sprintf("/?page=2&page_size=%d", size), nil), 500)
		if page != 2 || actual != size {
			t.Fatalf("size=%d: page=%d size=%d", size, page, actual)
		}
	}
	for _, query := range []string{"", "page_size=0", "page_size=501", "page_size=bad"} {
		page, size := pageParams(httptest.NewRequest("GET", "/?"+query, nil), 500)
		if page != 1 || size != 20 {
			t.Fatalf("默认分页错误: %s page=%d size=%d", query, page, size)
		}
	}
}

func TestAdminLargePages(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	a, err := s.Account(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
		SELECT $1,$2,'charge','model','large-pagination',-1,0,$3 FROM generate_series(1,505)`, a.ID, user, s.now()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO billing_transactions(user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,started_at)
		SELECT $1,$2,'model',$3,'large-pagination','测试用户','billing@example.com','local','running',0,'{}',$4 FROM generate_series(1,505)`, user, a.ID, model, s.now()); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	for _, endpoint := range []string{"entries", "reconciliation"} {
		for _, size := range []int{200, 500} {
			seen := make(map[string]bool)
			for page, offset := 1, 0; offset < 505; page, offset = page+1, offset+size {
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest("GET", fmt.Sprintf("/billing/%s?content=large-pagination&page_size=%d&page=%d", endpoint, size, page), nil))
				var out struct {
					Total   *int             `json:"total"`
					Size    int              `json:"page_size"`
					HasNext bool             `json:"has_next"`
					Items   []map[string]any `json:"items"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
					t.Fatal(err)
				}
				if w.Code != 200 {
					t.Fatalf("%s 查询失败: %d %s", endpoint, w.Code, w.Body)
				}
				if out.Size != size || len(out.Items) != min(size, 505-offset) {
					t.Fatalf("%s 大分页错误: size=%d count=%d offset=%d", endpoint, out.Size, len(out.Items), offset)
				}
				if endpoint == "entries" {
					if out.Total != nil || out.HasNext != (offset+size < 505) {
						t.Fatalf("流水必须省略总数并正确判断下一页: %s", w.Body)
					}
				} else if out.Total == nil || *out.Total != 505 {
					t.Fatalf("待处理交易总数错误: %s", w.Body)
				}
				for _, item := range out.Items {
					id := item["id"].(string)
					if seen[id] {
						t.Fatalf("分页重复: %s", id)
					}
					seen[id] = true
				}
			}
			if len(seen) != 505 {
				t.Fatalf("分页丢失记录: %d", len(seen))
			}
		}
	}
}
