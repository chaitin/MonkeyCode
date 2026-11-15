package enginehost

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type Commands interface {
	ExchangeAt(context.Context, string, json.RawMessage, time.Time) (any, error)
}

func (s *Service) WithCommands(commands Commands) *Service { s.commands = commands; return s }
func (s *Service) exchange(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HostID    string          `json:"host_id"`
		At        time.Time       `json:"at"`
		Payload   json.RawMessage `json:"payload"`
		Signature []byte          `json:"signature"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !idPattern.MatchString(in.HostID) || !validReportTime(in.At, time.Now()) || len(in.Payload) > 32<<10 || !json.Valid(in.Payload) {
		fail(w, r, 400, "同步消息格式无效")
		return
	}
	q := sqlc.New(s.pool)
	public, err := q.HostKey(r.Context(), in.HostID)
	if err != nil {
		fail(w, r, 401, "宿主不可用")
		return
	}
	message := []byte("monkeyai-engine/exchange/v2\n" + s.server + "\n" + in.HostID + "\n" + in.At.UTC().Format(time.RFC3339Nano) + "\n" + hash(in.Payload))
	if len(public) != ed25519.PublicKeySize || !ed25519.Verify(public, message, in.Signature) {
		fail(w, r, 401, "宿主签名无效")
		return
	}
	if s.commands == nil {
		fail(w, r, 503, "环境命令服务尚未配置")
		return
	}
	out, err := s.commands.ExchangeAt(r.Context(), in.HostID, in.Payload, in.At)
	if err != nil {
		fail(w, r, 409, "同步未接受，请保留本地结果并重试")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, out)
}
