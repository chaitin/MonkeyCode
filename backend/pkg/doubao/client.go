package doubao

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// dialDoubao 与豆包 WSS 建立连接,注入鉴权 header,并发送 Full Client Request。
// 返回连接、本次请求 id、豆包响应 header 中的 X-Tt-Logid (排障必备)。
//
// 鉴权使用新版控制台 (单 X-Api-Key);旧版控制台 X-Api-App-Key/X-Api-Access-Key
// 暂未实现,如需支持再加分支。
func dialDoubao(ctx context.Context, url, apiKey, resourceID string, payload fullClientPayload) (
	conn *websocket.Conn, requestID, logid string, err error,
) {
	requestID = uuid.NewString()

	hdr := http.Header{}
	// 新版控制台支持两种鉴权 header 写法,部分服务期望 X-Api-Key,
	// 部分新版豆包服务统一走 Authorization: Bearer。同时发两份,匹配到哪个走哪个。
	hdr.Set("X-Api-Key", apiKey)
	hdr.Set("Authorization", "Bearer "+apiKey)
	hdr.Set("X-Api-Resource-Id", resourceID)
	hdr.Set("X-Api-Request-Id", requestID)
	hdr.Set("X-Api-Connect-Id", requestID)

	c, resp, err := websocket.DefaultDialer.DialContext(ctx, url, hdr)
	if err != nil {
		// 401/403 等握手失败时 resp 可能非空,把 logid 也带回去帮助排障
		if resp != nil {
			logid = resp.Header.Get("X-Tt-Logid")
			return nil, requestID, logid, fmt.Errorf("dial doubao (logid=%s, status=%d): %w", logid, resp.StatusCode, err)
		}
		return nil, requestID, "", fmt.Errorf("dial doubao: %w", err)
	}
	logid = resp.Header.Get("X-Tt-Logid")

	// 发送 Full Client Request: header + sequence(=1) + payload_size + gzip(JSON)
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		_ = c.Close()
		return nil, requestID, logid, fmt.Errorf("marshal payload: %w", err)
	}
	if err := c.WriteMessage(websocket.BinaryMessage, encodeFullClientRequest(payloadJSON)); err != nil {
		_ = c.Close()
		return nil, requestID, logid, fmt.Errorf("send full client req: %w", err)
	}

	// 读首个响应,确认远端已就绪 (任何非 error 帧都视为 OK)
	_, msg, err := c.ReadMessage()
	if err != nil {
		_ = c.Close()
		return nil, requestID, logid, fmt.Errorf("read first resp: %w", err)
	}
	f, err := parseFrame(msg)
	if err != nil {
		_ = c.Close()
		return nil, requestID, logid, fmt.Errorf("parse first resp: %w", err)
	}
	if f.messageType == msgTypeServerError {
		_ = c.Close()
		msg := extractErrorMessage(f.payload)
		return nil, requestID, logid, fmt.Errorf("doubao reject (code=%d, logid=%s): %s", f.errorCode, logid, msg)
	}
	return c, requestID, logid, nil
}

// extractErrorMessage 尝试从 server error payload 解出可读 message;失败就 raw 返回。
func extractErrorMessage(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}
	var e serverErrorPayload
	if err := json.Unmarshal(payload, &e); err == nil && e.Error != "" {
		return e.Error
	}
	return string(payload)
}
