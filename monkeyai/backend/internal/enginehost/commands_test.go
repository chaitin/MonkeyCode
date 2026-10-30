package enginehost

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

type commandHandler struct {
	calls int
	host  string
}

func (h *commandHandler) Exchange(_ context.Context, id string, _ json.RawMessage) (any, error) {
	h.calls++
	h.host = id
	return map[string]any{"protocol": 1, "targets": []any{}}, nil
}
func TestCommandSignatureBindsPurposePayloadAndConsumesChallenge(t *testing.T) {
	db := testPool(t)
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	id := resource.ID()
	if _, err := db.Exec(t.Context(), `INSERT INTO engine_hosts(id,name,architecture,version,public_key,status,enrollment_hash,enrollment_expires_at) VALUES($1,'test','amd64','v1',$2,'active','known',now()+interval '1 hour')`, id, []byte(pub)); err != nil {
		t.Fatal(err)
	}
	handler := &commandHandler{}
	s := NewService(db).WithInstallation("https://console.example", "", "v1").WithCommands(handler)
	router := chi.NewRouter()
	s.Register(router)
	response := call(router, "POST", "/api/host/v1/challenges", map[string]string{"host_id": id})
	var challenge struct {
		Value string `json:"challenge"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &challenge); err != nil {
		t.Fatal(err)
	}
	payload := json.RawMessage(`{"protocol":1,"cursor":"","results":[]}`)
	signature := func(purpose string, raw json.RawMessage) []byte {
		return ed25519.Sign(key, []byte("monkeyai-engine/"+purpose+"/v1\nhttps://console.example\n"+id+"\n"+challenge.Value+"\n"+hash(raw)))
	}
	body := map[string]any{"host_id": id, "challenge": challenge.Value, "payload": payload, "signature": signature("heartbeat", payload)}
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 401 {
		t.Fatal("心跳签名被跨用途复用")
	}
	body["signature"] = signature("exchange", json.RawMessage(`{}`))
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 401 {
		t.Fatal("正文篡改被接受")
	}
	body["signature"] = signature("exchange", payload)
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 200 {
		t.Fatalf("合法同步失败：%d %s", w.Code, w.Body)
	}
	if handler.calls != 1 || handler.host != id {
		t.Fatal("命令服务的宿主身份不一致")
	}
	if w := call(router, "POST", "/api/host/v1/exchange", body); w.Code != 401 {
		t.Fatal("同步挑战被重放")
	}
}
