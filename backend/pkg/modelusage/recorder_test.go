package modelusage

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/clickhouse"
)

type clickhouseStub struct {
	event clickhouse.ModelUsageEvent
	err   error
}

func (s *clickhouseStub) InsertModelUsageEvent(ctx context.Context, event clickhouse.ModelUsageEvent) error {
	s.event = event
	return s.err
}

type contextRepoStub struct {
	ctx UsageContext
	err error
}

func (s *contextRepoStub) Resolve(ctx context.Context, taskID, userID uuid.UUID) (UsageContext, error) {
	return s.ctx, s.err
}

func TestRecorderMapsCachedTokens(t *testing.T) {
	ch := &clickhouseStub{}
	taskID := uuid.New()
	userID := uuid.New()
	teamID := uuid.New()
	projectID := uuid.New()
	rec := NewRecorder(ch, &contextRepoStub{ctx: UsageContext{TeamID: teamID, ProjectID: projectID}}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := rec.Record(context.Background(), Event{
		EventTime:    time.Date(2026, 6, 4, 19, 0, 0, 0, time.UTC),
		TaskID:       taskID,
		UserID:       userID,
		Provider:     "openai",
		ModelID:      "model-1",
		ModelName:    "gpt-4o",
		InputTokens:  100,
		OutputTokens: 20,
		CachedTokens: 30,
		TotalTokens:  120,
		Success:      true,
		RequestID:    "request-1",
		Source:       "runtime",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ch.event.TeamID != teamID.String() || ch.event.ProjectID != projectID.String() {
		t.Fatalf("event context = %#v", ch.event)
	}
	if ch.event.CachedTokens != 30 {
		t.Fatalf("cached_tokens = %d, want 30", ch.event.CachedTokens)
	}
}

func TestRecorderIgnoresClickHouseWriteFailure(t *testing.T) {
	ch := &clickhouseStub{err: errors.New("clickhouse down")}
	rec := NewRecorder(ch, &contextRepoStub{}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	err := rec.Record(context.Background(), Event{TaskID: uuid.New(), UserID: uuid.New(), Source: "runtime"})
	if err != nil {
		t.Fatalf("record error = %v, want nil", err)
	}
}
