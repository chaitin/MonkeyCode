package loki

import (
	"encoding/json"
	"testing"
	"time"
)

func marshalChunk(t *testing.T, event string) string {
	t.Helper()
	line, err := json.Marshal(map[string]any{
		"event": event,
	})
	if err != nil {
		t.Fatalf("marshal chunk: %v", err)
	}
	return string(line)
}

func TestFindLatestRoundStart(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	taskCreatedAt := base

	tests := []struct {
		name    string
		entries []LogEntry
		want    time.Time
	}{
		{
			name: "returns latest user input even when later task events exist",
			entries: []LogEntry{
				{Timestamp: base.Add(1 * time.Second), Line: marshalChunk(t, "user-input")},
				{Timestamp: base.Add(2 * time.Second), Line: marshalChunk(t, "task-started")},
				{Timestamp: base.Add(3 * time.Second), Line: marshalChunk(t, "task-ended")},
				{Timestamp: base.Add(4 * time.Second), Line: marshalChunk(t, "user-input")},
				{Timestamp: base.Add(5 * time.Second), Line: marshalChunk(t, "task-started")},
				{Timestamp: base.Add(6 * time.Second), Line: marshalChunk(t, "task-running")},
			},
			want: base.Add(4 * time.Second),
		},
		{
			name: "returns newest user input when new round has not started",
			entries: []LogEntry{
				{Timestamp: base.Add(1 * time.Second), Line: marshalChunk(t, "user-input")},
				{Timestamp: base.Add(2 * time.Second), Line: marshalChunk(t, "task-started")},
				{Timestamp: base.Add(3 * time.Second), Line: marshalChunk(t, "task-ended")},
				{Timestamp: base.Add(4 * time.Second), Line: marshalChunk(t, "user-input")},
			},
			want: base.Add(4 * time.Second),
		},
		{
			name: "falls back to task created at when no user input exists",
			entries: []LogEntry{
				{Timestamp: base.Add(2 * time.Second), Line: marshalChunk(t, "task-started")},
				{Timestamp: base.Add(3 * time.Second), Line: marshalChunk(t, "task-running")},
			},
			want:    taskCreatedAt,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := findLatestRoundStartFromEntries(tt.entries, taskCreatedAt)
			if !got.Equal(tt.want) {
				t.Fatalf("findLatestRoundStartFromEntries = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestFilterEntriesByTimeWindow(t *testing.T) {
	base := time.Unix(1_700_000_000, 0).UTC()
	entries := []LogEntry{
		{Timestamp: base.Add(1 * time.Second), Line: marshalChunk(t, "user-input")},
		{Timestamp: base.Add(2 * time.Second), Line: marshalChunk(t, "task-started")},
		{Timestamp: base.Add(3 * time.Second), Line: marshalChunk(t, "task-ended")},
		{Timestamp: base.Add(4 * time.Second), Line: marshalChunk(t, "user-input")},
		{Timestamp: base.Add(5 * time.Second), Line: marshalChunk(t, "task-started")},
		{Timestamp: base.Add(6 * time.Second), Line: marshalChunk(t, "task-running")},
	}

	got := filterEntriesByTimeWindow(entries, base.Add(4*time.Second), base.Add(6*time.Second))

	if len(got) != 3 {
		t.Fatalf("len(filterEntriesByTimeWindow) = %d, want 3", len(got))
	}

	wantEvents := []string{"user-input", "task-started", "task-running"}
	for i, entry := range got {
		var chunk struct {
			Event string `json:"event"`
		}
		if err := json.Unmarshal([]byte(entry.Line), &chunk); err != nil {
			t.Fatalf("unmarshal entry %d: %v", i, err)
		}
		if chunk.Event != wantEvents[i] {
			t.Fatalf("event[%d] = %s, want %s", i, chunk.Event, wantEvents[i])
		}
	}
}
