package v1

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
)

func TestBuildTaskStreamsFromHistoryEntriesStopsWhenEnded(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	streams, ended := buildTaskStreamsFromHistoryEntries([]loki.LogEntry{
		{Timestamp: base, Line: `{"event":"task-started","kind":"acp_event"}`},
		{Timestamp: base.Add(time.Second), Line: `{"event":"task-ended","kind":"acp_event"}`},
	}, logger)

	if !ended {
		t.Fatalf("ended = false, want true")
	}
	if len(streams) != 2 {
		t.Fatalf("len(streams) = %d, want 2", len(streams))
	}
}

func TestBuildTaskStreamsFromHistoryEntriesKeepsStreamingWhenNotEnded(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	streams, ended := buildTaskStreamsFromHistoryEntries([]loki.LogEntry{
		{Timestamp: base, Line: `{"event":"task-started","kind":"acp_event"}`},
		{Timestamp: base.Add(time.Second), Line: `{"event":"task-running","kind":"agent_message_chunk"}`},
	}, logger)

	if ended {
		t.Fatalf("ended = true, want false")
	}
	if len(streams) != 2 {
		t.Fatalf("len(streams) = %d, want 2", len(streams))
	}
}
