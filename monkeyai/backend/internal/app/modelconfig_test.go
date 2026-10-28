package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testModelConfiguration(t *testing.T, pool *pgxpool.Pool, handler http.Handler, adminCookie *http.Cookie) {
	t.Helper()
	cleanupModel := func(id string) {
		t.Cleanup(func() {
			for _, query := range []string{
				`DELETE FROM resource_access_grants WHERE resource_type='model' AND resource_id=$1`,
				`DELETE FROM models WHERE id=$1`,
			} {
				if _, err := pool.Exec(context.Background(), query, id); err != nil {
					t.Error(err)
				}
			}
		})
	}
	var upstreamCalls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		if r.Method != "GET" || r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer discovery-test-key" {
			t.Error("上游查询路径或密钥错误")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"id": "remote-model"}}})
	}))
	defer upstream.Close()
	call := func(method, path string, body any, admin bool) (int, resource.Object, http.Header) {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("Content-Type", "application/json")
		if admin {
			req.AddCookie(adminCookie)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if strings.Contains(response.Body.String(), "discovery-test-key") {
			t.Fatal("API 不能返回上游密钥")
		}
		var out resource.Object
		if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
			t.Fatalf("响应无效: %s", response.Body.String())
		}
		return response.Code, out, response.Header()
	}
	discovery := resource.Object{"base_url": upstream.URL + "/v1", "protocol": "openai_responses", "api_key": "discovery-test-key"}
	if code, _, _ := call("POST", "/api/admin/v1/models/discover", discovery, false); code != http.StatusUnauthorized || upstreamCalls.Load() != 0 {
		t.Fatalf("匿名查询未被拒绝: %d", code)
	}
	code, result, headers := call("POST", "/api/admin/v1/models/discover", discovery, true)
	if code != http.StatusOK || headers.Get("Cache-Control") != "no-store" || len(result["models"].([]any)) != 1 {
		t.Fatalf("查询接口失败: %d %v", code, result)
	}
	text := resource.Object{"model_id": "remote-model", "display_name": "远程文本模型", "kind": "text", "protocol": "openai_responses", "base_url": upstream.URL + "/v1", "api_key": "discovery-test-key", "credit_multiplier": 1, "advanced_config": resource.Object{"context_window_tokens": 1000, "max_output_tokens": 100}, "authorization": resource.Object{"all_users": true}}
	code, saved, _ := call("POST", "/api/admin/v1/models", text, true)
	if code != http.StatusCreated {
		t.Fatalf("保存文本模型失败: %d %v", code, saved)
	}
	cleanupModel(saved.String("id"))
	discovery["api_key"], discovery["model_resource_id"] = "", saved.String("id")
	if code, out, _ := call("POST", "/api/admin/v1/models/discover", discovery, true); code != http.StatusOK || upstreamCalls.Load() != 2 {
		t.Fatalf("已保存密钥查询失败: %d %v", code, out)
	}
	var discoveryAudits int
	var exposedKey bool
	if err := pool.QueryRow(t.Context(), `SELECT count(*), coalesce(bool_or(strpos(request_params::text,$2)>0),false) FROM audits WHERE action='discover' AND request_params->>'route'=$1`, "/api/admin/v1/models/discover", "discovery-test-key").Scan(&discoveryAudits, &exposedKey); err != nil || discoveryAudits != 2 || exposedKey {
		t.Fatalf("查询审计分类或密钥脱敏错误: %d %v %v", discoveryAudits, exposedKey, err)
	}
	image := resource.Object{"model_id": "independent-image-prices", "display_name": "独立生图价格", "kind": "image", "protocol": "image_generation", "provider": "openai_images", "base_url": upstream.URL + "/v1", "api_key": "discovery-test-key", "image_config": resource.Object{"qualities": []string{"1K", "2K", "4K"}, "aspect_ratios": []string{"1:1"}, "default_quality": "1K", "default_aspect_ratio": "1:1"}, "image_pricing": resource.Object{"rates": []resource.Object{{"quality": "1K", "credits_per_image": "0"}, {"quality": "2K", "credits_per_image": "7.123456"}, {"quality": "4K", "credits_per_image": "19"}}}, "authorization": resource.Object{"all_users": true}}
	code, saved, _ = call("POST", "/api/admin/v1/models", image, true)
	if code != http.StatusCreated {
		t.Fatalf("独立价格保存失败: %d %v", code, saved)
	}
	cleanupModel(saved.String("id"))
	pricing := saved["image_pricing"].(map[string]any)
	if len(pricing["rates"].([]any)) != 3 || pricing["base_credits_per_image"] != nil || pricing["quality_multipliers"] != nil {
		t.Fatalf("新价格响应格式错误: %+v", pricing)
	}
	image["image_pricing"] = resource.Object{"rates": []resource.Object{{"quality": "1K", "credits_per_image": "0"}, {"quality": "2K", "credits_per_image": "8.000001"}, {"quality": "4K", "credits_per_image": "20"}}}
	code, saved, _ = call("PUT", "/api/admin/v1/models/"+saved.String("id"), image, true)
	if code != http.StatusOK {
		t.Fatalf("独立价格更新失败: %d %v", code, saved)
	}
	pricing = saved["image_pricing"].(map[string]any)
	if pricing["rates"].([]any)[1].(map[string]any)["credits_per_image"] != "8.000001" {
		t.Fatalf("六位小数未保存: %+v", pricing)
	}
}
