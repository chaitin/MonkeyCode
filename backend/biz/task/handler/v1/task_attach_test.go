package v1

import (
	"encoding/json"
	"io"
	"log/slog"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/domain"
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
	assertUserInputPayload(t, got, "旧输入", []domain.TaskAttachment{})
}

func TestNormalizeUserInputDataKeepsPayloadShape(t *testing.T) {
	got := normalizeUserInputData([]byte(`{"content":"5paw6L6T5YWl","attachments":[{"url":"https://oss.example.com/temp/a.txt","filename":"a.txt"}]}`))
	assertUserInputPayload(t, got, "新输入", []domain.TaskAttachment{{URL: "https://oss.example.com/temp/a.txt", Filename: "a.txt"}})
}

func TestNormalizeUserInputDataKeepsLegacyPayloadAttachmentsWhenContentEmpty(t *testing.T) {
	got := normalizeUserInputData([]byte(`{"content":"","attachments":[{"url":"https://oss.example.com/temp/empty.txt","filename":"empty.txt"}]}`))
	assertUserInputPayload(t, got, "", []domain.TaskAttachment{{URL: "https://oss.example.com/temp/empty.txt", Filename: "empty.txt"}})
}

func TestNormalizeUserInputDataConvertsPlaintextStoragePayloadToFrontendPayload(t *testing.T) {
	got := normalizeUserInputData([]byte(`{"encoding":"plaintext","content":"继续处理","attachments":[{"url":"https://oss.example.com/temp/a.txt","filename":"a.txt"}]}`))
	assertUserInputPayload(t, got, "继续处理", []domain.TaskAttachment{{URL: "https://oss.example.com/temp/a.txt", Filename: "a.txt"}})
}

func TestNormalizeUserInputDataKeepsPlaintextBase64LookingContent(t *testing.T) {
	got := normalizeUserInputData([]byte(`{"encoding":"plaintext","content":"aGVsbG8="}`))
	assertUserInputPayload(t, got, "aGVsbG8=", []domain.TaskAttachment{})
}

func TestNormalizeUserInputDataKeepsPlaintextStoragePayloadAttachmentsWhenContentEmpty(t *testing.T) {
	got := normalizeUserInputData([]byte(`{"encoding":"plaintext","content":"","attachments":[{"url":"https://oss.example.com/temp/empty.txt","filename":"empty.txt"}]}`))
	assertUserInputPayload(t, got, "", []domain.TaskAttachment{{URL: "https://oss.example.com/temp/empty.txt", Filename: "empty.txt"}})
}

func assertUserInputPayload(t *testing.T, data []byte, wantContent string, wantAttachments []domain.TaskAttachment) {
	t.Helper()

	var payload domain.TaskUserInputPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("unmarshal normalized payload: %v, data = %s", err, data)
	}
	if string(payload.Content) != wantContent {
		t.Fatalf("content = %q, want %q, data = %s", string(payload.Content), wantContent, data)
	}
	if !reflect.DeepEqual(payload.Attachments, wantAttachments) {
		t.Fatalf("attachments = %#v, want %#v, data = %s", payload.Attachments, wantAttachments, data)
	}
}
