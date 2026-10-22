package session

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type indexSettings struct {
	enabled bool
	level   string
}

func (p *indexSettings) GetValue(context.Context, string) (json.RawMessage, error) {
	return json.Marshal(map[string]any{"enabled": p.enabled, "level": p.level})
}

type indexRuntime struct {
	status, boot string
	epoch        int64
}

func (r *indexRuntime) RuntimeStatus(context.Context, string, string) (string, string, int64, error) {
	return r.status, r.boot, r.epoch, nil
}

func TestSessionIndexOwnerPolicyAndStaleness(t *testing.T) {
	s, ids, user, token := sessionDBFixture(t)
	policy := &indexSettings{enabled: true, level: "full"}
	runtime := &indexRuntime{status: "online", boot: resource.ID(), epoch: 2}
	s.WithReportingSettings(policy).WithRuntimeStatus(runtime)
	hash := sha256.Sum256([]byte(token))
	if _, err := s.pool.Exec(t.Context(), "UPDATE oauth_grants SET scopes=ARRAY['session:read'] WHERE id=(SELECT grant_id FROM oauth_tokens WHERE access_token_hash=$1)", hex.EncodeToString(hash[:])); err != nil {
		t.Fatal(err)
	}
	machine, id := resource.ID(), resource.ID()
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO sessions(id,owner_user_id,device_id,title,session_type,client_type,client_name,started_at,placeholder,host_verified,state_received_at,last_live_report_at,live_boot_id,live_lease_epoch)
	VALUES($1,$2,$3,'目录标题','conversation','desktop','测试',now(),false,true,now(),now(),$4,2)`, id, user, machine, runtime.boot); err != nil {
		t.Fatal(err)
	}
	other := resource.ID()
	if _, err := s.pool.Exec(t.Context(), "INSERT INTO users(id,name,email) VALUES($1,'其他用户',$2)", other, other+"@example.com"); err != nil {
		t.Fatal(err)
	}
	foreign := resource.ID()
	if _, err := s.pool.Exec(t.Context(), `INSERT INTO sessions(id,owner_user_id,device_id,title,session_type,client_type,client_name,started_at,placeholder,host_verified)
	VALUES($1,$2,$3,'其他标题','conversation','desktop','测试',now(),false,true)`, foreign, other, machine); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	router.Use(ids.RequireAgent)
	s.RegisterAgent(router)
	call := func(path string, want int) resource.Object {
		t.Helper()
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("目录状态=%d want=%d body=%s", response.Code, want, response.Body.String())
		}
		out := resource.Object{}
		if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	out := call("/sessions?machine_id="+machine, 200)
	if len(out["items"].([]any)) != 1 {
		t.Fatal("目录泄露其他用户或缺少宿主")
	}
	item := resource.Object(out["items"].([]any)[0].(map[string]any))
	if item.String("id") != id || item["stale"] != false || item.String("title") != "目录标题" {
		t.Fatalf("摘要错误：%v", item)
	}
	call("/sessions/"+foreign, 404)
	call("/sessions?owner_user_id="+other, 400)
	policy.level = "stats"
	if _, ok := call("/sessions/"+id, 200)["title"]; ok {
		t.Fatal("统计级策略不得返回标题")
	}
	runtime.boot = resource.ID()
	if call("/sessions/"+id, 200)["stale"] != true {
		t.Fatal("旧进程摘要应标记 stale")
	}
	runtime.status = "offline"
	if call("/sessions/"+id, 200)["device_status"] != "offline" {
		t.Fatal("离线状态错误")
	}
	policy.enabled = false
	call("/sessions", 403)
	if enabled, err := s.IndexEnabled(t.Context()); err != nil || enabled {
		t.Fatal("禁止上报时不能发布目录能力")
	}
}

func TestLiveSummaryRequiresCurrentBootAndEpoch(t *testing.T) {
	runtime := &indexRuntime{status: "online", boot: resource.ID(), epoch: 2}
	s := NewService(nil).WithRuntimeStatus(runtime)
	live := &liveSummary{BootID: runtime.boot, LeaseEpoch: 2}
	if err := s.liveSummary(t.Context(), resource.ID(), resource.ID(), live, true); err != nil {
		t.Fatal(err)
	}
	if err := s.liveSummary(t.Context(), resource.ID(), resource.ID(), live, false); err == nil {
		t.Fatal("自报身份不能写入在线摘要")
	}
	live.LeaseEpoch = 1
	if err := s.liveSummary(t.Context(), resource.ID(), resource.ID(), live, true); err == nil {
		t.Fatal("旧 epoch 不应更新在线状态")
	}
	seq := int64(1)
	in := sessionInput{StateSeq: &seq, Runtime: live}
	_, first, err := validateState(in, sessionRow{Session: Session{StateSeq: 0}})
	if err != nil {
		t.Fatal(err)
	}
	in.Runtime = &liveSummary{BootID: resource.ID(), LeaseEpoch: 3}
	_, second, err := validateState(in, sessionRow{Session: Session{StateSeq: 0}})
	if err != nil || hex.EncodeToString(first) != hex.EncodeToString(second) {
		t.Fatal("连接代次不应改变业务快照摘要")
	}
}
