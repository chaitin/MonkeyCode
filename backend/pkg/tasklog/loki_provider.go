package tasklog

import (
	"context"
	"encoding/json"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

type LokiProvider struct {
	client *loki.Client
}

func NewLokiProvider(client *loki.Client) *LokiProvider {
	return &LokiProvider{client: client}
}

func (p *LokiProvider) Name() string {
	return "loki"
}

func (p *LokiProvider) QueryWindow(ctx context.Context, taskID uuid.UUID, start, end time.Time) ([]Entry, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	entries, err := p.client.QueryWindowByTaskID(ctx, taskID.String(), start, end)
	if err != nil {
		return nil, err
	}

	out := make([]Entry, 0, len(entries))
	for _, entry := range entries {
		var chunk taskflow.TaskChunk
		if err := json.Unmarshal([]byte(entry.Line), &chunk); err != nil {
			continue
		}
		out = append(out, Entry{
			TaskID: taskID,
			TS:     entry.Timestamp.UTC(),
			Event:  chunk.Event,
			Kind:   chunk.Kind,
			Data:   string(chunk.Data),
			MsgSeq: entry.Labels["msg_seq"],
			Labels: entry.Labels,
		})
	}
	return out, nil
}

func (p *LokiProvider) QueryLatestTurn(ctx context.Context, taskID uuid.UUID, taskCreatedAt, end time.Time) (*QueryLatestTurnResp, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	turnStart, err := p.client.FindLatestRoundStart(ctx, taskID.String(), taskCreatedAt, end)
	if err != nil {
		return nil, err
	}
	entries, err := p.QueryWindow(ctx, taskID, turnStart, end)
	if err != nil {
		return nil, err
	}
	resp := &QueryLatestTurnResp{
		Entries: entries,
		HasMore: turnStart.After(taskCreatedAt),
	}
	if resp.HasMore {
		resp.NextCursor = strconv.FormatInt(turnStart.UnixNano()-1, 10)
	}
	return resp, nil
}

func (p *LokiProvider) QueryTurns(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, cursor string, limit int) (*QueryTurnsResp, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	end := time.Now()
	if cursor != "" {
		ns, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil {
			return nil, err
		}
		end = time.Unix(0, ns)
	}
	resp, err := p.client.QueryRounds(ctx, taskID.String(), taskCreatedAt, end, limit)
	if err != nil {
		return nil, err
	}
	out := &QueryTurnsResp{
		Chunks:  make([]*TurnChunk, 0, len(resp.Chunks)),
		HasMore: resp.HasMore,
	}
	if resp.HasMore && resp.NextTS > 0 {
		out.NextCursor = strconv.FormatInt(resp.NextTS, 10)
	}
	for _, chunk := range resp.Chunks {
		out.Chunks = append(out.Chunks, &TurnChunk{
			Data:      chunk.Data,
			Event:     chunk.Event,
			Kind:      chunk.Kind,
			Timestamp: chunk.Timestamp,
			Labels:    chunk.Labels,
		})
	}
	return out, nil
}
