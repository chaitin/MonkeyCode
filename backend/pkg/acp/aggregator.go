package acp

import (
	"encoding/json"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// 需要聚合的 sessionUpdate 类型
const (
	SessionUpdateAgentMessageChunk = "agent_message_chunk"
	SessionUpdateAgentThoughtChunk = "agent_thought_chunk"
)

// ACPData 表示 ACP 协议的 data 结构
type ACPData struct {
	SessionID string    `json:"sessionId"`
	Update    ACPUpdate `json:"update"`
}

// ACPUpdate 表示 ACP 协议的 update 结构
type ACPUpdate struct {
	SessionUpdate string     `json:"sessionUpdate"`
	Content       ACPContent `json:"content"`
}

// ACPContent 表示 ACP 协议的 content 结构
type ACPContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// WriteFunc 写入函数
type WriteFunc func(stream domain.TaskStream) error

// ChunkAggregator 聚合器
type ChunkAggregator struct {
	writeFunc WriteFunc
}

// NewChunkAggregator 创建聚合器
func NewChunkAggregator(writeFunc WriteFunc) *ChunkAggregator {
	return &ChunkAggregator{
		writeFunc: writeFunc,
	}
}

// Process 处理一批 TaskChunk
func (a *ChunkAggregator) Process(chunks []taskflow.TaskChunk) error {
	if len(chunks) == 0 {
		return nil
	}

	// 用于聚合的临时状态
	var (
		textBuffer    strings.Builder
		lastSessionID string
		lastUpdate    string
		lastKind      string
		lastTimestamp int64
		lastACPData   *ACPData
	)

	flush := func() error {
		if textBuffer.Len() == 0 {
			return nil
		}

		aggregatedData := ACPData{
			SessionID: lastSessionID,
			Update: ACPUpdate{
				SessionUpdate: lastUpdate,
				Content: ACPContent{
					Type: "text",
					Text: textBuffer.String(),
				},
			},
		}
		if lastACPData != nil {
			aggregatedData.Update.Content.Type = lastACPData.Update.Content.Type
		}

		data, err := json.Marshal(aggregatedData)
		if err != nil {
			return err
		}

		if err := a.writeFunc(domain.TaskStream{
			Type:      consts.TaskStreamTypeTaskRunning,
			Kind:      lastKind,
			Data:      data,
			Timestamp: lastTimestamp,
		}); err != nil {
			return err
		}

		textBuffer.Reset()
		return nil
	}

	for _, chunk := range chunks {
		// 非 task-running 直接写入
		if chunk.Event != string(consts.TaskStreamTypeTaskRunning) {
			if err := flush(); err != nil {
				return err
			}
			if err := a.writeFunc(domain.TaskStream{
				Type:      consts.TaskStreamType(chunk.Event),
				Kind:      chunk.Kind,
				Data:      chunk.Data,
				Timestamp: chunk.Timestamp,
			}); err != nil {
				return err
			}
			continue
		}

		// 解析 ACP data
		var acpData ACPData
		if err := json.Unmarshal(chunk.Data, &acpData); err != nil {
			// 解析失败直接写入
			if err := flush(); err != nil {
				return err
			}
			if err := a.writeFunc(domain.TaskStream{
				Type:      consts.TaskStreamType(chunk.Event),
				Kind:      chunk.Kind,
				Data:      chunk.Data,
				Timestamp: chunk.Timestamp,
			}); err != nil {
				return err
			}
			continue
		}

		// 检查是否可聚合
		isAggregatable := acpData.Update.SessionUpdate == SessionUpdateAgentMessageChunk ||
			acpData.Update.SessionUpdate == SessionUpdateAgentThoughtChunk

		if !isAggregatable {
			// 不可聚合，直接写入
			if err := flush(); err != nil {
				return err
			}
			if err := a.writeFunc(domain.TaskStream{
				Type:      consts.TaskStreamType(chunk.Event),
				Kind:      chunk.Kind,
				Data:      chunk.Data,
				Timestamp: chunk.Timestamp,
			}); err != nil {
				return err
			}
			continue
		}

		// 可聚合：检查是否需要先刷新（sessionID 或 sessionUpdate 变化）
		needFlush := textBuffer.Len() > 0 &&
			(lastSessionID != acpData.SessionID || lastUpdate != acpData.Update.SessionUpdate)

		if needFlush {
			if err := flush(); err != nil {
				return err
			}
		}

		// 追加文本
		textBuffer.WriteString(acpData.Update.Content.Text)
		lastSessionID = acpData.SessionID
		lastUpdate = acpData.Update.SessionUpdate
		lastKind = chunk.Kind
		lastTimestamp = chunk.Timestamp
		lastACPData = &acpData
	}

	// 刷新剩余数据
	return flush()
}
