package modelusage

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/pkg/clickhouse"
)

type ClickHouse interface {
	InsertModelUsageEvent(ctx context.Context, event clickhouse.ModelUsageEvent) error
}

type ContextRepo interface {
	Resolve(ctx context.Context, taskID, userID uuid.UUID) (UsageContext, error)
}

type UsageContext struct {
	TeamID    uuid.UUID
	ProjectID uuid.UUID
}

type Event struct {
	EventTime    time.Time
	TaskID       uuid.UUID
	UserID       uuid.UUID
	Provider     string
	ModelID      string
	ModelName    string
	InputTokens  uint64
	OutputTokens uint64
	CachedTokens uint64
	TotalTokens  uint64
	Success      bool
	DurationMS   uint64
	TraceID      string
	RequestID    string
	Source       string
}

type Recorder struct {
	ch     ClickHouse
	repo   ContextRepo
	logger *slog.Logger
}

func NewRecorder(ch ClickHouse, repo ContextRepo, logger *slog.Logger) *Recorder {
	if logger == nil {
		logger = slog.Default()
	}
	return &Recorder{ch: ch, repo: repo, logger: logger.With("module", "modelusage")}
}

func (r *Recorder) Record(ctx context.Context, event Event) error {
	if r == nil || r.ch == nil {
		return nil
	}
	if event.EventTime.IsZero() {
		event.EventTime = time.Now()
	}
	if event.Source == "" {
		event.Source = "runtime"
	}
	var usageCtx UsageContext
	if r.repo != nil {
		var err error
		usageCtx, err = r.repo.Resolve(ctx, event.TaskID, event.UserID)
		if err != nil {
			r.logger.WarnContext(ctx, "resolve model usage context failed", "task_id", event.TaskID, "user_id", event.UserID, "error", err)
		}
	}
	chEvent := clickhouse.ModelUsageEvent{
		EventTime:    event.EventTime,
		TeamID:       usageCtx.TeamID.String(),
		UserID:       event.UserID.String(),
		TaskID:       event.TaskID.String(),
		ProjectID:    usageCtx.ProjectID.String(),
		Provider:     event.Provider,
		ModelID:      event.ModelID,
		ModelName:    event.ModelName,
		InputTokens:  event.InputTokens,
		OutputTokens: event.OutputTokens,
		CachedTokens: event.CachedTokens,
		TotalTokens:  event.TotalTokens,
		RequestCount: 1,
		Success:      event.Success,
		DurationMS:   event.DurationMS,
		TraceID:      event.TraceID,
		RequestID:    event.RequestID,
		Source:       event.Source,
	}
	if err := r.ch.InsertModelUsageEvent(ctx, chEvent); err != nil {
		r.logger.WarnContext(ctx, "write model usage event failed", "task_id", event.TaskID, "user_id", event.UserID, "model_id", event.ModelID, "trace_id", event.TraceID, "error", err)
	}
	return nil
}

type EntContextRepo struct {
	db *db.Client
}

func NewEntContextRepo(db *db.Client) *EntContextRepo {
	return &EntContextRepo{db: db}
}

func (r *EntContextRepo) Resolve(ctx context.Context, taskID, userID uuid.UUID) (UsageContext, error) {
	var usageCtx UsageContext
	if r == nil || r.db == nil {
		return usageCtx, nil
	}
	tk, err := r.db.Task.Query().
		Where(task.IDEQ(taskID)).
		WithProjectTasks().
		First(ctx)
	if err != nil {
		return usageCtx, err
	}
	member, err := r.db.TeamMember.Query().
		Where(teammember.UserIDEQ(userID)).
		First(ctx)
	if err != nil {
		return usageCtx, err
	}
	usageCtx.TeamID = member.TeamID
	if len(tk.Edges.ProjectTasks) > 0 && tk.Edges.ProjectTasks[0].ProjectID != nil {
		usageCtx.ProjectID = *tk.Edges.ProjectTasks[0].ProjectID
	}
	return usageCtx, nil
}
