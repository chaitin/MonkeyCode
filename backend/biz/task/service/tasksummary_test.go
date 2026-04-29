package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/llm"
	"github.com/chaitin/MonkeyCode/backend/pkg/tasklog"
)

type fakeTasklogGateway struct {
	responses []*tasklog.QueryTurnsResp
	stores    []consts.LogStore
	calls     int
}

func (f *fakeTasklogGateway) QueryTurns(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, cursor string, limit int, store consts.LogStore) (*tasklog.QueryTurnsResp, error) {
	f.calls++
	f.stores = append(f.stores, store)
	if len(f.responses) == 0 {
		return &tasklog.QueryTurnsResp{}, nil
	}
	resp := f.responses[0]
	f.responses = f.responses[1:]
	return resp, nil
}

func TestTasklogConversationReaderFetchClickHouseChunks(t *testing.T) {
	taskID := uuid.New()
	createdAt := time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC)
	runningData := mustJSON(t, wsData{Update: wsUpdate{SessionUpdate: "agent_message_chunk", Content: wsContent{Text: "好的"}}})
	gateway := &fakeTasklogGateway{responses: []*tasklog.QueryTurnsResp{{
		Chunks: []*tasklog.TurnChunk{
			{Event: "task-running", Data: []byte(base64.StdEncoding.EncodeToString(runningData)), Timestamp: 2},
			{Event: "user-input", Data: []byte(base64.StdEncoding.EncodeToString([]byte("请帮我修复测试"))), Timestamp: 1},
		},
	}}}
	reader := newTasklogConversationReader(gateway, slog.New(slog.NewTextHandler(io.Discard, nil)))

	messages, err := reader.Fetch(context.Background(), taskID, createdAt, consts.LogStoreClickHouse, "初始任务", 3)
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if len(messages) != 3 {
		t.Fatalf("len(messages) = %d, want 3: %#v", len(messages), messages)
	}
	assertMessage(t, messages[0], "user", "初始任务")
	assertMessage(t, messages[1], "user", "请帮我修复测试")
	assertMessage(t, messages[2], "assistant", "好的")
	if len(gateway.stores) != 1 || gateway.stores[0] != consts.LogStoreClickHouse {
		t.Fatalf("gateway stores = %#v, want [%q]", gateway.stores, consts.LogStoreClickHouse)
	}
}

func TestNormalizeSummaryLogStoreEmptyMeansLoki(t *testing.T) {
	if got := normalizeSummaryLogStore(nil); got != consts.LogStoreLoki {
		t.Fatalf("normalizeSummaryLogStore(nil) = %q, want %q", got, consts.LogStoreLoki)
	}
	empty := consts.LogStore("")
	if got := normalizeSummaryLogStore(&empty); got != consts.LogStoreLoki {
		t.Fatalf("normalizeSummaryLogStore(empty) = %q, want %q", got, consts.LogStoreLoki)
	}
	clickhouse := consts.LogStoreClickHouse
	if got := normalizeSummaryLogStore(&clickhouse); got != consts.LogStoreClickHouse {
		t.Fatalf("normalizeSummaryLogStore(clickhouse) = %q, want %q", got, consts.LogStoreClickHouse)
	}
}

func TestBuildSummaryConversationUsesUserInputPayloadContent(t *testing.T) {
	taskID := uuid.New()
	payload := []byte(`{"content":"请继续实现","attachment_urls":["https://oss.example.com/temp/a.txt"]}`)
	messages, err := buildSummaryConversation(
		context.Background(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		taskID,
		[]*tasklog.TurnChunk{{Event: "user-input", Data: []byte(base64.StdEncoding.EncodeToString(payload)), Timestamp: 1}},
		1,
		3,
		"",
	)
	if err != nil {
		t.Fatalf("buildSummaryConversation() error = %v", err)
	}
	if len(messages) != 1 || messages[0].Content != "请继续实现" {
		t.Fatalf("messages = %#v", messages)
	}
}

func TestTasklogConversationReaderStopsWhenMaxRoundsReached(t *testing.T) {
	runningData := mustJSON(t, wsData{Update: wsUpdate{SessionUpdate: "agent_message_chunk", Content: wsContent{Text: "助手回复"}}})
	gateway := &fakeTasklogGateway{responses: []*tasklog.QueryTurnsResp{
		{
			Chunks: []*tasklog.TurnChunk{
				{Event: "user-input", Data: []byte(base64.StdEncoding.EncodeToString([]byte("第一轮"))), Timestamp: 1},
				{Event: "task-running", Data: []byte(base64.StdEncoding.EncodeToString(runningData)), Timestamp: 2},
			},
			HasMore:    true,
			NextCursor: "next",
		},
		{
			Chunks: []*tasklog.TurnChunk{{Event: "user-input", Data: []byte(base64.StdEncoding.EncodeToString([]byte("不应读取"))), Timestamp: 0}},
		},
	}}
	reader := newTasklogConversationReader(gateway, slog.New(slog.NewTextHandler(io.Discard, nil)))

	messages, err := reader.Fetch(context.Background(), uuid.New(), time.Now(), consts.LogStoreLoki, "", 1)
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if gateway.calls != 1 {
		t.Fatalf("gateway calls = %d, want 1", gateway.calls)
	}
	if len(messages) != 2 {
		t.Fatalf("len(messages) = %d, want 2: %#v", len(messages), messages)
	}
	assertMessage(t, messages[0], "user", "第一轮")
	assertMessage(t, messages[1], "assistant", "助手回复")
}

func TestTasklogConversationReaderKeepsOnlyRecentMaxRoundsInSinglePage(t *testing.T) {
	latestRunningData := mustJSON(t, wsData{Update: wsUpdate{SessionUpdate: "agent_message_chunk", Content: wsContent{Text: "最新助手"}}})
	olderRunningData := mustJSON(t, wsData{Update: wsUpdate{SessionUpdate: "agent_message_chunk", Content: wsContent{Text: "更旧助手"}}})
	gateway := &fakeTasklogGateway{responses: []*tasklog.QueryTurnsResp{{
		Chunks: []*tasklog.TurnChunk{
			{Event: "user-input", Data: []byte(base64.StdEncoding.EncodeToString([]byte("最新用户"))), Timestamp: 1},
			{Event: "task-running", Data: []byte(base64.StdEncoding.EncodeToString(latestRunningData)), Timestamp: 2},
			{Event: "user-input", Data: []byte(base64.StdEncoding.EncodeToString([]byte("更旧用户"))), Timestamp: 3},
			{Event: "task-running", Data: []byte(base64.StdEncoding.EncodeToString(olderRunningData)), Timestamp: 4},
		},
	}}}
	reader := newTasklogConversationReader(gateway, slog.New(slog.NewTextHandler(io.Discard, nil)))

	messages, err := reader.Fetch(context.Background(), uuid.New(), time.Now(), consts.LogStoreClickHouse, "", 1)
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("len(messages) = %d, want 2: %#v", len(messages), messages)
	}
	assertMessage(t, messages[0], "user", "最新用户")
	assertMessage(t, messages[1], "assistant", "最新助手")
}

func TestTasklogConversationReaderAnchorsSummaryToInitialContent(t *testing.T) {
	gateway := &fakeTasklogGateway{responses: []*tasklog.QueryTurnsResp{{
		Chunks: []*tasklog.TurnChunk{
			{Event: "user-input", Data: []byte(base64.StdEncoding.EncodeToString([]byte("不相干的上下文摘要"))), Timestamp: 1},
		},
	}}}
	reader := newTasklogConversationReader(gateway, slog.New(slog.NewTextHandler(io.Discard, nil)))

	messages, err := reader.Fetch(context.Background(), uuid.New(), time.Now(), consts.LogStoreClickHouse, "修复 ClickHouse 日志查询失败", 1)
	if err != nil {
		t.Fatalf("Fetch() error = %v", err)
	}
	if gateway.calls != 0 {
		t.Fatalf("gateway calls = %d, want 0", gateway.calls)
	}
	if len(messages) != 1 {
		t.Fatalf("len(messages) = %d, want 1: %#v", len(messages), messages)
	}
	assertMessage(t, messages[0], "user", "修复 ClickHouse 日志查询失败")
}

func TestFallbackSummaryForLowInformationGreeting(t *testing.T) {
	summary, ok := fallbackSummaryFromConversation([]llm.Message{
		{Role: "user", Content: "hi"},
	}, 300)
	if !ok {
		t.Fatal("expected fallback summary")
	}
	if summary != "hi" {
		t.Fatalf("summary = %q, want hi", summary)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json marshal: %v", err)
	}
	return data
}

func assertMessage(t *testing.T, got llm.Message, role, content string) {
	t.Helper()
	if got.Role != role || got.Content != content {
		t.Fatalf("message = {Role:%q Content:%q}, want {Role:%q Content:%q}", got.Role, got.Content, role, content)
	}
}
