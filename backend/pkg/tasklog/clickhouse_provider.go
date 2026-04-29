package tasklog

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/clickhouse"
)

type ClickHouseProvider struct {
	client *clickhouse.Client
}

func NewClickHouseProvider(client *clickhouse.Client) *ClickHouseProvider {
	return &ClickHouseProvider{client: client}
}

func (p *ClickHouseProvider) Name() string {
	return "clickhouse"
}

func (p *ClickHouseProvider) QueryLatestTurn(ctx context.Context, taskID uuid.UUID, taskCreatedAt, end time.Time) (*QueryLatestTurnResp, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	table := p.client.Table()

	qTurn := fmt.Sprintf(`
		SELECT max(turn_seq)
		FROM %s
		WHERE task_id = ? AND ts >= ? AND ts <= ?`, table)

	var latestTurn sql.NullInt64
	if err := p.client.QueryRowContext(ctx, qTurn, taskID, taskCreatedAt, end).Scan(&latestTurn); err != nil {
		return nil, err
	}
	if !latestTurn.Valid || latestTurn.Int64 <= 0 {
		return &QueryLatestTurnResp{}, nil
	}

	entries, err := p.queryEntriesByTurn(ctx, taskID, uint32(latestTurn.Int64), taskCreatedAt, end)
	if err != nil {
		return nil, err
	}

	resp := &QueryLatestTurnResp{
		Entries: entries,
	}
	hasMore, err := p.hasLowerTurn(ctx, taskID, uint32(latestTurn.Int64))
	if err != nil {
		return nil, err
	}
	resp.HasMore = hasMore
	if hasMore {
		resp.NextCursor = strconv.FormatUint(uint64(latestTurn.Int64), 10)
	}
	return resp, nil
}

func (p *ClickHouseProvider) QueryTurns(ctx context.Context, taskID uuid.UUID, _ time.Time, cursor string, limit int) (*QueryTurnsResp, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	table := p.client.Table()
	if limit <= 0 {
		limit = 2
	}
	if limit > 10 {
		limit = 10
	}

	cursorFilter := ""
	args := []any{taskID, taskID}
	if cursor != "" {
		turn, err := strconv.ParseUint(cursor, 10, 32)
		if err != nil {
			return nil, err
		}
		cursorFilter = "AND turn_seq < ?"
		args = append(args, uint32(turn))
	}
	args = append(args, limit+1)

	q := fmt.Sprintf(`
SELECT ts, event, kind, data, turn_seq
FROM %[1]s
WHERE task_id = ? AND turn_seq IN (
	SELECT DISTINCT turn_seq
	FROM %[1]s
	WHERE task_id = ?
	%[2]s
	ORDER BY turn_seq DESC
	LIMIT ?
)
ORDER BY turn_seq DESC, ts ASC, msg_seq_start ASC, ingest_id ASC
`, table, cursorFilter)

	rows, err := p.client.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chunks := make([]*TurnChunk, 0)
	seenTurns := make(map[uint32]struct{}, limit+1)
	turns := make([]uint32, 0, limit+1)
	for rows.Next() {
		var (
			ts      time.Time
			event   string
			kind    string
			data    string
			turnSeq uint32
		)
		if err := rows.Scan(&ts, &event, &kind, &data, &turnSeq); err != nil {
			return nil, err
		}
		if _, ok := seenTurns[turnSeq]; !ok {
			seenTurns[turnSeq] = struct{}{}
			turns = append(turns, turnSeq)
		}
		if len(turns) > limit {
			continue
		}
		chunks = append(chunks, &TurnChunk{
			Data:      []byte(data),
			Event:     event,
			Kind:      kind,
			Timestamp: ts.UTC().UnixNano(),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(turns) == 0 {
		return &QueryTurnsResp{}, nil
	}

	hasMore := len(turns) > limit
	if hasMore {
		turns = turns[:limit]
	}

	resp := &QueryTurnsResp{
		Chunks:  chunks,
		HasMore: hasMore,
	}
	if hasMore {
		oldest := turns[len(turns)-1]
		resp.NextCursor = strconv.FormatUint(uint64(oldest), 10)
	}
	return resp, nil
}

func (p *ClickHouseProvider) hasLowerTurn(ctx context.Context, taskID uuid.UUID, turnSeq uint32) (bool, error) {
	if turnSeq == 0 {
		return false, nil
	}
	table := p.client.Table()

	q := fmt.Sprintf(`
SELECT turn_seq
		FROM %s
		WHERE task_id = ? AND turn_seq < ?
		GROUP BY turn_seq
		ORDER BY turn_seq DESC
		LIMIT ?`, table)

	rows, err := p.client.QueryContext(ctx, q, taskID, turnSeq, 1)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	return rows.Next(), rows.Err()
}

func (p *ClickHouseProvider) queryEntriesByTurn(ctx context.Context, taskID uuid.UUID, turnSeq uint32, start, end time.Time) ([]Entry, error) {
	table := p.client.Table()
	q := fmt.Sprintf(`
SELECT task_id, ts, event, kind, turn_seq, data, msg_seq_start, msg_seq_end
		FROM %s
		WHERE task_id = ? AND turn_seq = ? AND ts >= ? AND ts <= ?
		ORDER BY turn_seq ASC, ts ASC, msg_seq_start ASC, ingest_id ASC`, table)

	rows, err := p.client.QueryContext(ctx, q, taskID, turnSeq, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]Entry, 0)
	for rows.Next() {
		var (
			id          string
			ts          time.Time
			event       string
			kind        string
			seq         uint32
			data        string
			msgSeqStart uint64
			msgSeqEnd   uint64
		)
		if err := rows.Scan(&id, &ts, &event, &kind, &seq, &data, &msgSeqStart, &msgSeqEnd); err != nil {
			return nil, err
		}
		parsedID, err := uuid.Parse(id)
		if err != nil {
			return nil, err
		}
		entries = append(entries, Entry{
			TaskID:  parsedID,
			TS:      ts.UTC(),
			Event:   event,
			Kind:    kind,
			TurnSeq: seq,
			Data:    data,
			MsgSeq:  formatMsgSeqRange(msgSeqStart, msgSeqEnd),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

func formatMsgSeqRange(start, end uint64) string {
	if start == 0 && end == 0 {
		return ""
	}
	if start == end {
		return strconv.FormatUint(start, 10)
	}
	return fmt.Sprintf("%d-%d", start, end)
}
