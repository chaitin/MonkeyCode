package v1

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/tasklog"
)

func TestBuildTaskStreamsFromLogEntriesStopsWhenEnded(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	streams, ended := buildTaskStreamsFromLogEntries([]tasklog.Entry{
		{TaskID: uuid.Nil, TS: base, Event: "task-started", Kind: "acp_event"},
		{TaskID: uuid.Nil, TS: base.Add(time.Second), Event: "task-ended", Kind: "acp_event"},
	}, logger)

	if !ended {
		t.Fatalf("ended = false, want true")
	}
	if len(streams) != 2 {
		t.Fatalf("len(streams) = %d, want 2", len(streams))
	}
}

func TestBuildTaskStreamsFromLogEntriesKeepsStreamingWhenNotEnded(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	streams, ended := buildTaskStreamsFromLogEntries([]tasklog.Entry{
		{TaskID: uuid.Nil, TS: base, Event: "task-started", Kind: "acp_event"},
		{TaskID: uuid.Nil, TS: base.Add(time.Second), Event: "task-running", Kind: "agent_message_chunk"},
	}, logger)

	if ended {
		t.Fatalf("ended = true, want false")
	}
	if len(streams) != 2 {
		t.Fatalf("len(streams) = %d, want 2", len(streams))
	}
}

func TestNormalizeUserInputDataWrapsLegacyText(t *testing.T) {
	got := normalizeUserInputData([]byte("旧输入"))
	if string(got) != `{"content":"5pen6L6T5YWl","attachments":[]}` {
		t.Fatalf("normalized = %s", got)
	}
}

func TestNormalizeUserInputDataDecodesLegacyPayloadContent(t *testing.T) {
	got := normalizeUserInputData([]byte(`{"content":"5paw6L6T5YWl","attachments":[{"url":"https://oss.example.com/temp/a.txt","filename":"a.txt"}]}`))
	if string(got) != `{"content":"5paw6L6T5YWl","attachments":[{"url":"https://oss.example.com/temp/a.txt","filename":"a.txt"}]}` {
		t.Fatalf("normalized = %s", got)
	}
}

func TestParseUserInputDataDecodesFrontendPayloadContent(t *testing.T) {
	got := parseUserInputData([]byte(`{"content":"5paw6L6T5YWl","attachments":[{"url":"https://oss.example.com/temp/a.txt","filename":"a.txt"}]}`))
	if string(got.Content) != "新输入" {
		t.Fatalf("content = %q, want 新输入", string(got.Content))
	}
	if len(got.Attachments) != 1 || got.Attachments[0].URL != "https://oss.example.com/temp/a.txt" {
		t.Fatalf("attachments = %#v", got.Attachments)
	}
}

func TestNormalizeUserInputDataEncodesPlainStoredPayloadForFrontend(t *testing.T) {
	got := normalizeUserInputData([]byte(`{"content":"新输入","attachments":[{"url":"https://oss.example.com/temp/a.txt","filename":"a.txt"}]}`))
	if string(got) != `{"content":"5paw6L6T5YWl","attachments":[{"url":"https://oss.example.com/temp/a.txt","filename":"a.txt"}]}` {
		t.Fatalf("normalized = %s", got)
	}
}
