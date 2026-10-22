package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"uuid"
)

func TestDirectoryFullSnapshotAcrossPages(t *testing.T) {
	f := newFixture(t)
	server := httptest.NewServer(f.ids.RequireAgent(f.s.Directory()))
	defer server.Close()
	var response struct {
		Items   []map[string]any `json:"items"`
		Total   int              `json:"total"`
		Version string           `json:"version"`
	}
	read := func(page int) string {
		t.Helper()
		url := server.URL + "?capability=execute&page_size=100&page=" + strconv.Itoa(page)
		req, _ := http.NewRequestWithContext(t.Context(), "GET", url, nil)
		req.Header.Set("Authorization", "Bearer "+f.token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 || json.NewDecoder(resp.Body).Decode(&response) != nil || response.Items == nil || response.Version == "" {
			t.Fatal("平铺目录不可解析")
		}
		return response.Version
	}
	empty := read(1)
	if response.Total != 0 || len(response.Items) != 0 {
		t.Fatal("空目录无效")
	}
	if _, err := f.pool.Exec(t.Context(), `INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,status,revoked_at,execution_public_key,key_id,remote_access_state)
 SELECT $1,gen_random_uuid(),'历史执行设备','macos','test','arm64','1','revoked',now(),decode(repeat('ab',32),'hex'),'key','revoked' FROM generate_series(1,101)`, f.user); err != nil {
		t.Fatal(err)
	}
	version := read(1)
	if version == empty || len(response.Items) != 100 || response.Total != 101 {
		t.Fatal("第一页没有完整筛选结果版本")
	}
	if read(2) != version || len(response.Items) != 1 || response.Total != 101 {
		t.Fatal("同次完整视图跨页版本不一致")
	}
	machine := response.Items[0]["machine_id"].(string)
	if _, err := f.pool.Exec(t.Context(), "UPDATE endpoints SET last_seen_at=now() WHERE user_id=$1 AND machine_id=$2", f.user, machine); err != nil {
		t.Fatal(err)
	}
	changed := read(2)
	if changed == version {
		t.Fatal("跨页更新观测资料必须改变版本")
	}
	if read(1) != changed {
		t.Fatal("重复读取相同完整视图版本不稳定")
	}
	if _, err := f.pool.Exec(t.Context(), `INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version)
 VALUES($1,$2,'仅资料','macos','test','arm64','1')`, f.user, uuid.New().String()); err != nil {
		t.Fatal(err)
	}
	if read(1) != changed || response.Total != 101 {
		t.Fatal("执行筛选被纯资料记录扰动")
	}
}
