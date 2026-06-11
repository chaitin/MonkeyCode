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

// QueryUserInputs 从 Loki 中查询任务的所有 user-input，正序返回。
// 当前实现：查询任务全窗口后内存过滤；对于实际 task 量级（user-input 通常 <100 条）可接受。
func (p *LokiProvider) QueryUserInputs(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, cursor string, limit int) (*QueryUserInputsResp, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	start := taskCreatedAt
	if cursor != "" {
		ns, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil {
			return nil, err
		}
		// 起点向后挪 1ns，避开上次最后一条
		next := time.Unix(0, ns+1).UTC()
		if next.After(start) {
			start = next
		}
	}
	end := time.Now()

	rawEntries, err := p.client.QueryWindowByTaskID(ctx, taskID.String(), start, end)
	if err != nil {
		return nil, err
	}

	entries := make([]*UserInputEntry, 0, limit+1)
	for _, entry := range rawEntries {
		var chunk taskflow.TaskChunk
		if err := json.Unmarshal([]byte(entry.Line), &chunk); err != nil {
			continue
		}
		if chunk.Event != "user-input" {
			continue
		}
		entries = append(entries, &UserInputEntry{
			Timestamp: entry.Timestamp.UTC().UnixNano(),
			Data:      chunk.Data,
		})
		if len(entries) > limit {
			break
		}
	}

	hasMore := len(entries) > limit
	if hasMore {
		entries = entries[:limit]
	}
	resp := &QueryUserInputsResp{
		Entries: entries,
		HasMore: hasMore,
	}
	if hasMore && len(entries) > 0 {
		resp.NextCursor = strconv.FormatInt(entries[len(entries)-1].Timestamp, 10)
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
