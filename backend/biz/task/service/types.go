package service

// lokiEntry 外层 WebSocket 日志格式
type lokiEntry struct {
	Data  string `json:"data"`  // base64 编码的数据
	Event string `json:"event"` // 事件类型
}

// userReply 用户回复
type userReply struct {
	AnswersJSON string `json:"answers_json"`
}

// agentMsgChunk agent 消息块
type agentMsgChunk struct {
	Content wsContent `json:"content"`
}

// wsData 解码后的 WebSocket 数据
type wsData struct {
	SessionID string   `json:"sessionId"`
	Update    wsUpdate `json:"update"`
}

// wsUpdate WebSocket 更新消息
type wsUpdate struct {
	SessionUpdate string    `json:"sessionUpdate"`
	Content       wsContent `json:"content"`
}

// wsContent 消息内容
type wsContent struct {
	Type    string `json:"type"`
	Text    string `json:"text"`
	Content string `json:"content"`
	Message string `json:"message"`
}
