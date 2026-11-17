package enginehost

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestHostListExcludesPendingBeforePagination(t *testing.T) {
	db := testPool(t)
	router := chi.NewRouter()
	registerAdmin(router, NewService(db))

	insert := func(status string, deleted bool) string {
		t.Helper()
		id := resource.ID()
		_, err := db.Exec(t.Context(), `INSERT INTO hosts(id,user_id,name,architecture,version,status,deleted_at) VALUES($1,$2,'host','amd64','v1',$3,CASE WHEN $4 THEN now() ELSE NULL END)`, id, testAdmin, status, deleted)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	pending := insert("pending", false)
	read := func(page int, wantTotal int, wantID string) {
		t.Helper()
		response := call(router, "GET", fmt.Sprintf("/engine-hosts?page=%d&page_size=1", page), nil)
		var data struct {
			Items []struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"items"`
			Total int `json:"total"`
		}
		if response.Code != 200 {
			t.Fatal(response.Code, response.Body.String())
		}
		if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
			t.Fatal(err)
		}
		if data.Total != wantTotal {
			t.Fatalf("total=%d want=%d", data.Total, wantTotal)
		}
		if wantID == "" {
			if len(data.Items) != 0 {
				t.Fatalf("应为空列表：%s", response.Body)
			}
			return
		}
		if len(data.Items) != 1 || data.Items[0].ID != wantID || data.Items[0].Status == "pending" {
			t.Fatalf("分页或过滤错误：%s", response.Body)
		}
	}
	read(1, 0, "")
	active := insert("active", false)
	revoked := insert("revoked", false)
	insert("active", true)
	insert("pending", false)
	if _, err := db.Exec(t.Context(), "UPDATE hosts SET created_at=now()-interval '2 minutes' WHERE id=$1", active); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(t.Context(), "UPDATE hosts SET created_at=now()-interval '1 minute' WHERE id=$1", revoked); err != nil {
		t.Fatal(err)
	}
	read(1, 2, revoked)
	read(2, 2, active)
	read(3, 2, "")
	if _, err := db.Exec(t.Context(), "UPDATE hosts SET status='active',created_at=now() WHERE id=$1", pending); err != nil {
		t.Fatal(err)
	}
	read(1, 3, pending)
}
