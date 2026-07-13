package loki

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
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
			want: taskCreatedAt,
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

func TestLatestMatchingEventUsesLabelsAndJSONFallback(t *testing.T) {
	base := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	events := map[string]struct{}{"user-input": {}, "task-event": {}}
	entries := []LogEntry{
		{Timestamp: base.Add(3 * time.Minute), Labels: map[string]string{"event": "task-running"}, Line: marshalChunk(t, "task-event")},
		{Timestamp: base.Add(2 * time.Minute), Labels: map[string]string{"event": "task-event"}},
		{Timestamp: base.Add(time.Minute), Line: marshalChunk(t, "user-input")},
	}

	got, ok := latestMatchingEvent(entries, events)
	if !ok || !got.Equal(base.Add(2*time.Minute)) {
		t.Fatalf("latest = %v, ok = %v", got, ok)
	}
}

func TestLatestMatchingEventReturnsMissing(t *testing.T) {
	entries := []LogEntry{{Timestamp: time.Now(), Line: marshalChunk(t, "task-running")}}
	if _, ok := latestMatchingEvent(entries, map[string]struct{}{"task-event": {}}); ok {
		t.Fatal("expected no matching event")
	}
}

func TestFindLastEventInPagesBackward(t *testing.T) {
	base := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		values := make([][]string, 0, 200)
		event := "task-running"
		if requests == 1 {
			for i := range 200 {
				ts := base.Add(-time.Duration(i) * time.Second)
				values = append(values, []string{strconv.FormatInt(ts.UnixNano(), 10), marshalChunk(t, "task-running")})
			}
		} else {
			event = "task-event"
			values = append(values, []string{strconv.FormatInt(base.Add(-201*time.Second).UnixNano(), 10), marshalChunk(t, "task-event")})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "success",
			"data": map[string]any{
				"resultType": "streams",
				"result": []any{map[string]any{
					"stream": map[string]string{"task_id": "task-1", "event": event},
					"values": values,
				}},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL)
	got, ok, err := client.FindLastEventIn(context.Background(), "task-1", []string{"user-input", "task-event"}, base.Add(-time.Hour), base.Add(time.Second))
	if err != nil || !ok {
		t.Fatalf("FindLastEventIn() ok = %v, err = %v", ok, err)
	}
	if !got.Equal(base.Add(-201*time.Second)) || requests != 2 {
		t.Fatalf("latest = %v, requests = %d", got, requests)
	}
}
