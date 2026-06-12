package tasklog

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrProviderUnavailable  = errors.New("tasklog provider unavailable")
	ErrUnsupported          = errors.New("tasklog operation unsupported")
	ErrDirectionUnsupported = errors.New("tasklog paging direction unsupported")
)

// Direction 轮次翻页方向
type Direction string

const (
	DirectionBackward Direction = "backward" // 从 cursor 往更早的轮次翻
	DirectionForward  Direction = "forward"  // 从 cursor 往更新的轮次翻
)

// QueryTurnsOpts 轮次查询选项
type QueryTurnsOpts struct {
	Cursor    string    // 分页游标；ClickHouse 下为 turn_seq，Loki 下为纳秒时间戳
	Limit     int       // 轮次数（默认 2，上限 10）
	Direction Direction // 翻页方向，空值等同 backward
	Inclusive bool      // 是否包含 cursor 指向的那一轮（跳转定位用），仅 ClickHouse 支持
}

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
	TurnSeq   uint32 // 轮次号，仅 ClickHouse 有值，Loki 为 0
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
	TurnSeq   uint32 // 轮次号，仅 ClickHouse 有值，Loki 为 0
}

// QueryUserInputsResp 用户输入列表查询响应
type QueryUserInputsResp struct {
	Entries    []*UserInputEntry
	HasMore    bool
	NextCursor string
}
