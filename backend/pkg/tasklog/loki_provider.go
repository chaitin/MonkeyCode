package tasklog

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
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

func (p *LokiProvider) LatestEventTime(ctx context.Context, taskID uuid.UUID, start, end time.Time, events []string) (time.Time, bool, error) {
	if p.client == nil {
		return time.Time{}, false, ErrProviderUnavailable
	}
	return p.client.FindLastEventIn(ctx, taskID.String(), events, start, end)
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

// QueryUserInputs 从 Loki 中查询任务的 user-input，倒序返回（最新在前），cursor 向更早翻页。
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

	end := time.Now()
	if cursor != "" {
		ns, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil {
			return nil, err
		}
		// 终点向前挪 1ns，避开上次最后一条
		end = time.Unix(0, ns-1).UTC()
	}
	if end.Before(taskCreatedAt) {
		return &QueryUserInputsResp{}, nil
	}

	rawEntries, err := p.client.QueryWindowByTaskID(ctx, taskID.String(), taskCreatedAt, end)
	if err != nil {
		return nil, err
	}

	// rawEntries 为正序，收集全部 user-input 后取最新的 limit 条，再反转为倒序
	matched := make([]*UserInputEntry, 0)
	for _, entry := range rawEntries {
		var chunk taskflow.TaskChunk
		if err := json.Unmarshal([]byte(entry.Line), &chunk); err != nil {
			continue
		}
		if chunk.Event != "user-input" {
			continue
		}
		matched = append(matched, &UserInputEntry{
			Timestamp: entry.Timestamp.UTC().UnixNano(),
			Data:      chunk.Data,
		})
	}

	hasMore := len(matched) > limit
	if hasMore {
		matched = matched[len(matched)-limit:]
	}
	slices.Reverse(matched)

	resp := &QueryUserInputsResp{
		Entries: matched,
		HasMore: hasMore,
	}
	if hasMore && len(matched) > 0 {
		resp.NextCursor = strconv.FormatInt(matched[len(matched)-1].Timestamp, 10)
	}
	return resp, nil
}

func (p *LokiProvider) QueryTurns(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, opts QueryTurnsOpts) (*QueryTurnsResp, error) {
	// Loki 日志没有轮次号，只能从时间游标倒序扫描，不支持向后翻页和包含定位。
	// 无 cursor 时 inclusive 本身无意义（CH 下也是 no-op），不拒绝。
	if (opts.Direction != "" && opts.Direction != DirectionBackward) || (opts.Inclusive && opts.Cursor != "") {
		return nil, fmt.Errorf("%w: loki only supports backward paging", ErrDirectionUnsupported)
	}
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	end := time.Now()
	if opts.Cursor != "" {
		ns, err := strconv.ParseInt(opts.Cursor, 10, 64)
		if err != nil {
			return nil, err
		}
		end = time.Unix(0, ns)
	}
	resp, err := p.client.QueryRounds(ctx, taskID.String(), taskCreatedAt, end, opts.Limit)
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
