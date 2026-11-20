package environment

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestCreatorAndNameFilterParams(t *testing.T) {
	for _, query := range []string{"user_id=invalid", "user_id=", "user_id=" + resource.ID() + "&user_id=" + resource.ID(), "user=a&user=b", "name=a&name=b"} {
		if _, err := listFilters(httptest.NewRequest("GET", "/?"+query, nil)); err == nil {
			t.Fatalf("accepted invalid filters %q", query)
		}
	}
	id := resource.ID()
	f, err := listFilters(httptest.NewRequest("GET", "/?user_id="+id+"&user=other&name=+Dev+", nil))
	if err != nil || f.userID == nil || *f.userID != id || f.user != "" || f.name != "Dev" {
		t.Fatal(f, err)
	}
}

func TestCreatorNameSearchBeforePagination(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	other := resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'Other','other@example.test')`, other); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(s.pool)
	spec, _ := json.Marshal(map[string]any{"resource": profile().Resource})
	for _, item := range []struct{ owner, name string }{{user, "Alpha_1"}, {user, "Alpha%2"}, {user, "Beta"}, {other, "AlphaX1"}} {
		id := resource.ID()
		if _, err := q.CreateEnvironment(ctx, sqlc.CreateEnvironmentParams{ID: id, UserID: item.owner, HostID: host, Name: item.name, InstanceID: resource.ID(), Spec: spec, CpuMillis: 1000, MemoryBytes: 512 << 20}); err != nil {
			t.Fatal(err)
		}
		if err := q.CreateRuntime(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		query url.Values
		count int
		owner string
	}{
		{url.Values{"name": {"ALPHA"}}, 3, ""}, {url.Values{"name": {"%"}}, 1, user}, {url.Values{"name": {"_"}}, 1, user},
		{url.Values{"user": {"环境测试"}, "name": {"alpha"}, "page_size": {"1"}, "page": {"2"}}, 1, user},
		{url.Values{"user": {"OTHER@EXAMPLE"}, "name": {"Alpha"}, "host_id": {host}}, 1, other},
		{url.Values{"user_id": {other}, "name": {"Alpha"}}, 1, other}, {url.Values{"user_id": {other}, "name": {"Beta"}}, 0, ""},
	} {
		w := httptest.NewRecorder()
		s.list(true)(w, httptest.NewRequest("GET", "/environments?"+tc.query.Encode(), nil))
		var list struct {
			Items []View `json:"items"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil || len(list.Items) != tc.count {
			t.Fatalf("%v: %d %s", tc.query, w.Code, w.Body)
		}
		for _, item := range list.Items {
			if tc.owner != "" && item.UserID != tc.owner {
				t.Fatalf("%v: unexpected user %s", tc.query, item.UserID)
			}
		}
	}
}
