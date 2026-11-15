package enginehost

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type commandHandler struct {
	db    *pgxpool.Pool
	mu    sync.Mutex
	calls int
	host  string
}

func (h *commandHandler) ExchangeAt(ctx context.Context, id string, _ json.RawMessage, at time.Time) (any, error) {
	// 模拟环境业务事务对报告时间的原子推进。
	n, err := h.db.Exec(ctx, "UPDATE hosts SET environment_synced_at=$2 WHERE id=$1 AND (environment_synced_at IS NULL OR environment_synced_at<$2)", id, at)
	if err != nil {
		return nil, err
	}
	if n.RowsAffected() != 1 {
		return nil, errors.New("报告已过期或重复")
	}
	h.mu.Lock()
	h.calls++
	h.host = id
	h.mu.Unlock()
	return map[string]any{"protocol": 1, "targets": []any{}}, nil
}
func TestCommandSignatureBindsPurposePayloadAndRejectsOldReports(t *testing.T) {
	db := testPool(t)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	id := resource.ID()
	if _, err := db.Exec(t.Context(), "INSERT INTO hosts(id,user_id,name,architecture,version,public_key,status) VALUES($1,$2,'test','amd64','v1',$3,'active')", id, testAdmin, []byte(pub)); err != nil {
		t.Fatal(err)
	}
	handler := &commandHandler{db: db}
	s := NewService(db).WithInstallation("https://console.example", "", "v1").WithCommands(handler)
	router := chi.NewRouter()
	s.Register(router)
	at := time.Now().UTC()
	payload := json.RawMessage(`{"protocol":1,"cursor":"","results":[]}`)
	signature := func(purpose string, raw json.RawMessage, stamp time.Time) []byte {
		return ed25519.Sign(key, []byte("monkeyai-engine/"+purpose+"/v2\n"+s.server+"\n"+id+"\n"+stamp.UTC().Format(time.RFC3339Nano)+"\n"+hash(raw)))
	}
	body := map[string]any{"host_id": id, "at": at, "payload": payload, "signature": signature("heartbeat", payload, at)}
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 401 {
		t.Fatal("允许跨用途签名", w.Code)
	}
	body["signature"] = signature("exchange", json.RawMessage(`{}`), at)
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 401 {
		t.Fatal("接受篡改内容", w.Code)
	}
	body["signature"] = signature("exchange", payload, at)
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 409 {
		t.Fatal("重复报告被执行", w.Code)
	}
	for _, stamp := range []time.Time{at.Add(-2 * time.Minute), at.Add(time.Minute)} {
		body["at"] = stamp
		body["signature"] = signature("exchange", payload, stamp)
		if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 400 {
			t.Fatal("过期或未来报告被接受", w.Code)
		}
	}
	if handler.calls != 1 || handler.host != id {
		t.Fatal("报告重复执行或宿主身份错误")
	}
}
