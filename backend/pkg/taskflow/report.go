package taskflow

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/coder/websocket"
)

// ReportEntry 对应服务端 /internal/ws/reports 推送的 JSON 结构
type ReportEntry struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Ts     int64  `json:"ts"`
	Data   []byte `json:"data"`
}

// ReportsStream 实现 Reporter
type ReportsStream struct {
	ctx    context.Context
	cancel context.CancelCauseFunc
	conn   *websocket.Conn
}

var _ Reporter = (*ReportsStream)(nil)

// BlockRead 持续读取 WS 文本消息, 反序列化为 ReportEntry 并回调
func (r *ReportsStream) BlockRead(fn func(ReportEntry)) error {
	for {
		select {
		case <-r.ctx.Done():
			return r.ctx.Err()
		default:
		}

		tp, data, err := r.conn.Read(r.ctx)
		if err != nil {
			return err
		}

		switch tp {
		case websocket.MessageText:
			var entry ReportEntry
			if err := json.Unmarshal(data, &entry); err != nil {
				slog.With("error", err).ErrorContext(context.Background(), "failed to unmarshal report entry")
				continue
			}
			fn(entry)
		case websocket.MessageBinary:
			// 忽略二进制数据
		}
	}
}

// Stop 终止订阅
func (r *ReportsStream) Stop() {
	r.cancel(fmt.Errorf("stop by user"))
}
