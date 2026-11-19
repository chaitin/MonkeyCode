package group

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/go-chi/chi/v5"
)

// 无效的配置请求不应进入写事务；无需启动数据库即可验证这部分接口合约。
func TestSupervisorRequestValidation(t *testing.T) {
	id := resource.ID()
	router := chi.NewRouter()
	NewService(nil).RegisterAdmin(router)
	for _, tc := range []struct {
		name, group string
		body        any
		status      int
	}{
		{"非法分组", "invalid", map[string]any{"supervisor_ids": []string{}}, 400},
		{"虚拟根分组", rootgroup.ID, map[string]any{"supervisor_ids": []string{}}, 404},
		{"遗漏名单不能清空", id, map[string]any{}, 400},
		{"空值不能清空", id, map[string]any{"supervisor_ids": nil}, 400},
		{"名单类型错误", id, map[string]any{"supervisor_ids": "abc"}, 400},
		{"非法用户ID", id, map[string]any{"supervisor_ids": []string{"invalid"}}, 400},
		{"超过人数上限", id, map[string]any{"supervisor_ids": make([]string, 10001)}, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := json.Marshal(tc.body)
			if err != nil {
				t.Fatal(err)
			}
			out := httptest.NewRecorder()
			router.ServeHTTP(out, httptest.NewRequest(http.MethodPut, "/groups/"+tc.group+"/supervisors", bytes.NewReader(body)))
			if out.Code != tc.status {
				t.Fatalf("期望 %d，实际 %d: %s", tc.status, out.Code, out.Body.String())
			}
		})
	}
}
