package tasklog

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrProviderUnavailable = errors.New("tasklog provider unavailable")
	ErrUnsupported         = errors.New("tasklog operation unsupported")
)

type Entry struct {
	TaskID  uuid.UUID
	TS      time.Time
	Event   string
	Kind    string
	TurnSeq uint32
	Data    string
	MsgSeq  string
	Labels  map[string]string
}

type QueryLatestTurnResp struct {
	Entries    []Entry
	HasMore    bool
	NextCursor string
}

type TurnChunk struct {
	Data      []byte
	Event     string
	Kind      string
	Timestamp int64
	Labels    map[string]string
}

type QueryTurnsResp struct {
	Chunks     []*TurnChunk
	HasMore    bool
	NextCursor string
}

// UserInputEntry 用户输入条目（轻量，仅供侧边栏使用）
type UserInputEntry struct {
	Timestamp int64  // 纳秒时间戳，对齐 chunk.Timestamp
	Data      []byte // 原始 chunk data（user-input payload 的 JSON）
}

// QueryUserInputsResp 用户输入列表查询响应
type QueryUserInputsResp struct {
	Entries    []*UserInputEntry
	HasMore    bool
	NextCursor string
}
