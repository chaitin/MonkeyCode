package doubao

import (
	"context"
	"errors"
	"log/slog"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/pkg/asr"
)

// DefaultURL 双向流式优化版接口 (bigmodel_async),性能 + 首尾字延迟最优,推荐生产使用。
const DefaultURL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"

// NewDoubao 构造豆包 ASR 客户端。配置不完整时返回 nil + nil (Provider 模式),
// 由调用方决定 fallback 行为。
func NewDoubao(cfg *config.Config, logger *slog.Logger) *Doubao {
	dcfg := cfg.Doubao
	if dcfg.AppKey == "" || dcfg.ResourceID == "" {
		return nil
	}
	if dcfg.URL == "" {
		dcfg.URL = DefaultURL
	}
	return &Doubao{cfg: dcfg, logger: logger.With("pkg", "doubao")}
}

// NewSession 实现 asr.Transcriber。
//
//   - 校验 Param 合法性 (format 必须是豆包支持的;sample_rate 固定 16000)
//   - 拨号 + 鉴权 + 发送 Full Client Request 并等首个响应
//   - 启动 recv goroutine 把豆包帧转 asr.Event 推给上层
//   - 立即 emit 一个 ready 事件 (带 logid),让上层下发给客户端
func (d *Doubao) NewSession(ctx context.Context, userID uuid.UUID, p asr.Param) (asr.Session, error) {
	format := p.Format
	if format == "" {
		format = "pcm"
	}
	if !isSupportedFormat(format) {
		return nil, errors.New("doubao: unsupported format: " + format)
	}

	payload := fullClientPayload{
		User: userMeta{Uid: userID.String()},
		Audio: audioMeta{
			Format:  format,
			Codec:   "raw",
			Rate:    16000,
			Bits:    16,
			Channel: 1,
		},
		Request: requestMeta{
			ModelName:      "bigmodel",
			EnableITN:      true,
			EnablePUNC:     true,
			EnableDDC:      p.Disfluency, // 顺滑映射
			ShowUtterances: true,
		},
	}

	conn, requestID, logid, err := dialDoubao(ctx, d.cfg.URL, d.cfg.AppKey, d.cfg.ResourceID, payload)
	if err != nil {
		return nil, err
	}

	sessionID := uuid.NewString()
	s := newSession(conn, d.logger.With("session_id", sessionID, "logid", logid), sessionID, requestID, logid)

	// recv goroutine 用独立 ctx,以便 Stop 能主动取消
	recvCtx, cancel := context.WithCancel(context.Background())
	s.cancelRecv = cancel
	go s.recvLoop(recvCtx)

	// 立刻 emit ready (带 logid),让上层 handler 透传给客户端
	s.emit(asr.Event{Type: asr.EventReady, Logid: logid})

	return s, nil
}

// isSupportedFormat 豆包文档明确支持的 format 白名单。
// pcm 与 wav 内部音频流要求 pcm_s16le;mp3 / ogg 由豆包侧解码。
func isSupportedFormat(f string) bool {
	switch f {
	case "pcm", "wav", "ogg", "mp3":
		return true
	}
	return false
}

// 编译期断言: *Doubao 实现 asr.Transcriber
var _ asr.Transcriber = (*Doubao)(nil)
