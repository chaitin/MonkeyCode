package tasklog

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
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

func (p *ClickHouseProvider) LatestEventTime(ctx context.Context, taskID uuid.UUID, start, end time.Time, events []string) (time.Time, bool, error) {
	if p.client == nil {
		return time.Time{}, false, ErrProviderUnavailable
	}
	if len(events) == 0 {
		return time.Time{}, false, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(events)), ",")
	query := fmt.Sprintf(`SELECT maxOrNull(ts) FROM %s WHERE task_id = ? AND ts >= ? AND ts <= ? AND event IN (%s)`, p.client.Table(), placeholders)
	args := make([]any, 0, len(events)+3)
	args = append(args, taskID, start, end)
	for _, event := range events {
		args = append(args, event)
	}
	var latest sql.NullTime
	if err := p.client.QueryRowContext(ctx, query, args...).Scan(&latest); err != nil {
		return time.Time{}, false, err
	}
	if !latest.Valid {
		return time.Time{}, false, nil
	}
	return latest.Time.UTC(), true, nil
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

// QueryTurns 按 turn_seq 双向翻页查询轮次。
// backward 返回轮间倒序（最新轮在前），forward 返回轮间正序（最旧轮在前），轮内均按时间正序；
// 即响应中最后一轮总是与 NextCursor 相邻的那一轮。
func (p *ClickHouseProvider) QueryTurns(ctx context.Context, taskID uuid.UUID, _ time.Time, opts QueryTurnsOpts) (*QueryTurnsResp, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	table := p.client.Table()
	limit := opts.Limit
	if limit <= 0 {
		limit = 2
	}
	if limit > 10 {
		limit = 10
	}

	var cmp, order string
	switch opts.Direction {
	case "", DirectionBackward:
		cmp, order = "<", "DESC"
		if opts.Inclusive {
			cmp = "<="
		}
	case DirectionForward:
		cmp, order = ">", "ASC"
		if opts.Inclusive {
			cmp = ">="
		}
	default:
		return nil, fmt.Errorf("%w: %q", ErrDirectionUnsupported, opts.Direction)
	}

	cursorFilter := ""
	args := []any{taskID, taskID}
	if opts.Cursor != "" {
		turn, err := strconv.ParseUint(opts.Cursor, 10, 32)
		if err != nil {
			return nil, err
		}
		cursorFilter = fmt.Sprintf("AND turn_seq %s ?", cmp)
		args = append(args, uint32(turn))
	}
	args = append(args, limit)

	q := fmt.Sprintf(`
SELECT ts, event, kind, data, turn_seq, msg_seq_start
FROM %[1]s
WHERE task_id = ? AND turn_seq IN (
	SELECT DISTINCT turn_seq
	FROM %[1]s
	WHERE task_id = ?
	%[2]s
	ORDER BY turn_seq %[3]s
	LIMIT ?
)
ORDER BY turn_seq %[3]s, ts ASC, msg_seq_start ASC, ingest_id ASC
`, table, cursorFilter, order)

	rows, err := p.client.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chunks := make([]*TurnChunk, 0)
	var boundarySeq uint32
	for rows.Next() {
		var (
			ts      time.Time
			event   string
			kind    string
			data    string
			turnSeq uint32
			seq     uint64
		)
		if err := rows.Scan(&ts, &event, &kind, &data, &turnSeq, &seq); err != nil {
			return nil, err
		}
		// 行按扫描方向排列，最后一行所在轮即本页边界轮
		boundarySeq = turnSeq
		chunks = append(chunks, &TurnChunk{
			Data:      []byte(data),
			Event:     event,
			Kind:      kind,
			Timestamp: ts.UTC().UnixNano(),
			Seq:       seq,
			TurnSeq:   turnSeq,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(chunks) == 0 {
		return &QueryTurnsResp{}, nil
	}

	hasMore, err := p.hasTurnBeyond(ctx, taskID, boundarySeq, cmp)
	if err != nil {
		return nil, err
	}

	resp := &QueryTurnsResp{
		Chunks:  chunks,
		HasMore: hasMore,
	}
	if hasMore {
		resp.NextCursor = strconv.FormatUint(uint64(boundarySeq), 10)
	}
	return resp, nil
}

// QueryUserInputs 查询任务的所有 user-input 日志，倒序（最新在前），用于侧边栏。
// cursor 编码上一页最后一条（最早一条）的 ts 纳秒，下次拉取 `ts < cursor` 的条目，向更早翻页。
func (p *ClickHouseProvider) QueryUserInputs(ctx context.Context, taskID uuid.UUID, _ time.Time, cursor string, limit int) (*QueryUserInputsResp, error) {
	if p.client == nil {
		return nil, ErrProviderUnavailable
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	table := p.client.Table()

	cursorFilter := ""
	args := []any{taskID}
	if cursor != "" {
		ns, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil {
			return nil, err
		}
		cursorFilter = "AND ts < ?"
		args = append(args, time.Unix(0, ns).UTC())
	}
	args = append(args, limit+1)

	// task_logs 是 MergeTree（无主键去重），偶发会因 ingest 重试落多行同 ts，
	// LIMIT 1 BY ts 保证每个时间戳只返回一行（取 msg_seq_start/ingest_id 最小的那条）。
	q := fmt.Sprintf(`
SELECT ts, data, turn_seq
FROM %s
WHERE task_id = ? AND event = 'user-input'
%s
ORDER BY ts DESC, msg_seq_start ASC, ingest_id ASC
LIMIT 1 BY ts
LIMIT ?
`, table, cursorFilter)

	rows, err := p.client.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]*UserInputEntry, 0, limit+1)
	for rows.Next() {
		var (
			ts      time.Time
			data    string
			turnSeq uint32
		)
		if err := rows.Scan(&ts, &data, &turnSeq); err != nil {
			return nil, err
		}
		entries = append(entries, &UserInputEntry{
			Timestamp: ts.UTC().UnixNano(),
			Data:      []byte(data),
			TurnSeq:   turnSeq,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
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

func (p *ClickHouseProvider) hasLowerTurn(ctx context.Context, taskID uuid.UUID, turnSeq uint32) (bool, error) {
	return p.hasTurnBeyond(ctx, taskID, turnSeq, "<")
}

// hasTurnBeyond 判断 turnSeq 在 cmp 方向（"<"/"<="/">"/">="，含等号时退化为去掉等号）上是否还有别的轮次
func (p *ClickHouseProvider) hasTurnBeyond(ctx context.Context, taskID uuid.UUID, turnSeq uint32, cmp string) (bool, error) {
	// 边界轮自身已返回，探测下一页只看严格大于/小于
	switch cmp {
	case "<", "<=":
		cmp = "<"
	case ">", ">=":
		cmp = ">"
	default:
		return false, fmt.Errorf("invalid turn comparator: %q", cmp)
	}
	if cmp == "<" && turnSeq == 0 {
		return false, nil
	}
	table := p.client.Table()

	q := fmt.Sprintf(`
SELECT turn_seq
		FROM %s
		WHERE task_id = ? AND turn_seq %s ?
		GROUP BY turn_seq
		LIMIT ?`, table, cmp)

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
