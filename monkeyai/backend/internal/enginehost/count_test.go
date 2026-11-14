package enginehost

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestEnvironmentCountsMatchHostDrilldown(t *testing.T) {
	pool := testPool(t)
	ctx := t.Context()
	user := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1::uuid,'count',$1::text || '@example.com')`, user); err != nil {
		t.Fatal(err)
	}
	hosts := []string{resource.ID(), resource.ID(), resource.ID()}
	for _, id := range hosts {
		if _, err := pool.Exec(ctx, `INSERT INTO hosts(id,user_id,name,architecture,version,status) VALUES($1,$2,'host','amd64','v1','revoked')`, id, user); err != nil {
			t.Fatal(err)
		}
	}
	for _, sample := range []struct {
		host                 int
		desired, phase       string
		generation, observed int
	}{
		{0, "running", "running", 1, 1}, {0, "stopped", "stopped", 1, 1}, {0, "deleted", "failed", 2, 2}, {0, "deleted", "running", 2, 1}, {0, "deleted", "deleted", 3, 2}, {0, "deleted", "deleted", 2, 2}, {1, "running", "pending", 1, 0},
	} {
		id := resource.ID()
		if _, err := pool.Exec(ctx, `INSERT INTO environments(id,user_id,host_id,name,generation,observed_generation,instance_id,desired,phase,spec,cpu_millis,memory_bytes) VALUES($1::uuid,$2,$3,'environment',$4,$5,$1,$6,$7,'{}',1000,536870912)`, id, user, hosts[sample.host], sample.generation, sample.observed, sample.desired, sample.phase); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, "INSERT INTO environment_runtimes(environment_id) VALUES($1)", id); err != nil {
			t.Fatal(err)
		}
	}
	router := chi.NewRouter()
	registerAdmin(router, NewService(pool))
	environment.NewService(pool).RegisterAdmin(router)
	response := call(router, "GET", "/engine-hosts?page_size=100", nil)
	var data struct {
		Items []struct {
			ID    string `json:"id"`
			Count int    `json:"environment_count"`
		} `json:"items"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &data) != nil || len(data.Items) != 3 {
		t.Fatal(response.Code, response.Body)
	}
	expected := map[string]int{hosts[0]: 5, hosts[1]: 1, hosts[2]: 0}
	for _, host := range data.Items {
		if host.Count != expected[host.ID] {
			t.Fatalf("宿主环境数错误: %s: %d", host.ID, host.Count)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/environments?host_id="+host.ID+"&page_size=100", nil))
		var list struct {
			Items []environment.View `json:"items"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil || len(list.Items) != host.Count {
			t.Fatalf("计数与默认下钻不一致: %s count=%d response=%s", host.ID, host.Count, w.Body)
		}
		for _, env := range list.Items {
			if env.HostID != host.ID {
				t.Fatal("下钻混入其他宿主", env)
			}
		}
	}
}
