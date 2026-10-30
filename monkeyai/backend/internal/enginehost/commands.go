package enginehost

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type Commands interface {
	Exchange(context.Context, string, json.RawMessage) (any, error)
}

func (s *Service) WithCommands(commands Commands) *Service { s.commands = commands; return s }
func (s *Service) exchange(w http.ResponseWriter, r *http.Request) {
	var in struct {
		HostID    string          `json:"host_id"`
		Challenge string          `json:"challenge"`
		Payload   json.RawMessage `json:"payload"`
		Signature []byte          `json:"signature"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !idPattern.MatchString(in.HostID) || len(in.Challenge) != 43 || len(in.Payload) > 32<<10 || !json.Valid(in.Payload) {
		fail(w, r, 400, "同步消息格式无效")
		return
	}
	q := sqlc.New(s.pool)
	public, err := q.HostKey(r.Context(), in.HostID)
	if err != nil {
		fail(w, r, 401, "宿主不可用")
		return
	}
	message := []byte("monkeyai-engine/exchange/v1\n" + s.server + "\n" + in.HostID + "\n" + in.Challenge + "\n" + hash(in.Payload))
	if len(public) != ed25519.PublicKeySize || !ed25519.Verify(public, message, in.Signature) {
		fail(w, r, 401, "宿主签名无效")
		return
	}
	n, err := q.ConsumeChallenge(r.Context(), sqlc.ConsumeChallengeParams{ID: in.HostID, Challenge: &in.Challenge})
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if n != 1 {
		fail(w, r, 401, "挑战已消费或过期")
		return
	}
	if s.commands == nil {
		fail(w, r, 503, "环境命令服务尚未配置")
		return
	}
	out, err := s.commands.Exchange(r.Context(), in.HostID, in.Payload)
	if err != nil {
		fail(w, r, 409, "同步未接受，请保留本地结果并重试")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, out)
}
