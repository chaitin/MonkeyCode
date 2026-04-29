package tasklog_test

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/clickhouse"
	"github.com/chaitin/MonkeyCode/backend/pkg/tasklog"
)

func TestClickHouseProviderQueryLatestTurnUsesTurnSeqCursor(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	start := time.Unix(1_710_000_000, 0).UTC()
	end := start.Add(time.Minute)

	mock.ExpectQuery("SELECT max\\(turn_seq\\)[\\s\\S]*WHERE task_id = \\? AND ts >= \\? AND ts <= \\?\\s*$").
		WithArgs(taskID, start, end).
		WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(2))

	rows := sqlmock.NewRows([]string{"task_id", "ts", "event", "kind", "turn_seq", "data", "msg_seq_start", "msg_seq_end"}).
		AddRow(taskID.String(), start.Add(10*time.Second), "user-input", "", 2, "hello", uint64(0), uint64(0)).
		AddRow(taskID.String(), start.Add(11*time.Second), "task-running", "acp_event", 2, `{"text":"world"}`, uint64(2), uint64(4))

	mock.ExpectQuery("SELECT task_id, ts, event, kind, turn_seq, data, msg_seq_start, msg_seq_end[\\s\\S]*ORDER BY turn_seq ASC, ts ASC, msg_seq_start ASC, ingest_id ASC\\s*$").
		WithArgs(taskID, 2, start, end).
		WillReturnRows(rows)

	mock.ExpectQuery("SELECT turn_seq[\\s\\S]*turn_seq < \\?[\\s\\S]*LIMIT \\?\\s*$").
		WithArgs(taskID, uint32(2), 1).
		WillReturnRows(sqlmock.NewRows([]string{"turn_seq"}).AddRow(1))

	provider := tasklog.NewClickHouseProvider(clickhouse.NewWithDBAndTable(db, "task_logs_test"))
	resp, err := provider.QueryLatestTurn(context.Background(), taskID, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Entries) != 2 {
		t.Fatalf("len(entries) = %d, want 2", len(resp.Entries))
	}
	if resp.Entries[0].MsgSeq != "" {
		t.Fatalf("entry[0].msg_seq = %q, want empty", resp.Entries[0].MsgSeq)
	}
	if resp.Entries[1].MsgSeq != "2-4" {
		t.Fatalf("entry[1].msg_seq = %q, want 2-4", resp.Entries[1].MsgSeq)
	}
	if !resp.HasMore {
		t.Fatal("expected has_more=true")
	}
	if resp.NextCursor != "2" {
		t.Fatalf("next_cursor = %q, want 2", resp.NextCursor)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClickHouseProviderQueryLatestTurnHandlesSparseTurnsWithoutMore(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	start := time.Unix(1_710_000_000, 0).UTC()
	end := start.Add(time.Minute)

	mock.ExpectQuery("SELECT max\\(turn_seq\\)[\\s\\S]*WHERE task_id = \\? AND ts >= \\? AND ts <= \\?\\s*$").
		WithArgs(taskID, start, end).
		WillReturnRows(sqlmock.NewRows([]string{"max"}).AddRow(5))

	rows := sqlmock.NewRows([]string{"task_id", "ts", "event", "kind", "turn_seq", "data", "msg_seq_start", "msg_seq_end"}).
		AddRow(taskID.String(), start.Add(10*time.Second), "user-input", "", 5, "hello", uint64(0), uint64(0))

	mock.ExpectQuery("SELECT task_id, ts, event, kind, turn_seq, data, msg_seq_start, msg_seq_end[\\s\\S]*ORDER BY turn_seq ASC, ts ASC, msg_seq_start ASC, ingest_id ASC\\s*$").
		WithArgs(taskID, 5, start, end).
		WillReturnRows(rows)

	mock.ExpectQuery("SELECT turn_seq[\\s\\S]*turn_seq < \\?[\\s\\S]*LIMIT \\?\\s*$").
		WithArgs(taskID, uint32(5), 1).
		WillReturnRows(sqlmock.NewRows([]string{"turn_seq"}))

	provider := tasklog.NewClickHouseProvider(clickhouse.NewWithDBAndTable(db, "task_logs_test"))
	resp, err := provider.QueryLatestTurn(context.Background(), taskID, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if resp.HasMore {
		t.Fatal("expected has_more=false")
	}
	if resp.NextCursor != "" {
		t.Fatalf("next_cursor = %q, want empty", resp.NextCursor)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClickHouseProviderQueryTurnsUsesSparseTurnCursor(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	chunkRows := sqlmock.NewRows([]string{"ts", "event", "kind", "data", "turn_seq"}).
		AddRow(time.Unix(1_710_000_010, 0).UTC(), "user-input", "", "latest", uint32(1))

	mock.ExpectQuery("SELECT ts, event, kind, data, turn_seq[\\s\\S]*FROM task_logs_test[\\s\\S]*turn_seq IN \\([\\s\\S]*SELECT DISTINCT turn_seq[\\s\\S]*FROM task_logs_test[\\s\\S]*turn_seq < \\?[\\s\\S]*LIMIT \\?[\\s\\S]*ORDER BY turn_seq DESC, ts ASC, msg_seq_start ASC, ingest_id ASC\\s*$").
		WithArgs(taskID, taskID, uint32(2), 2).
		WillReturnRows(chunkRows)

	provider := tasklog.NewClickHouseProvider(clickhouse.NewWithDBAndTable(db, "task_logs_test"))
	resp, err := provider.QueryTurns(context.Background(), taskID, time.Time{}, "2", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Chunks) != 1 {
		t.Fatalf("len(chunks) = %d, want 1", len(resp.Chunks))
	}
	if resp.HasMore {
		t.Fatal("expected has_more=false")
	}
	if resp.NextCursor != "" {
		t.Fatalf("next_cursor = %q, want empty", resp.NextCursor)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClickHouseProviderQueryTurnsSkipsExtraTurnFromLimitPlusOne(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	now := time.Unix(1_710_000_010, 0).UTC()
	chunkRows := sqlmock.NewRows([]string{"ts", "event", "kind", "data", "turn_seq"}).
		AddRow(now, "task-running", "acp_event", "turn-3", uint32(3)).
		AddRow(now.Add(time.Second), "task-running", "acp_event", "turn-2", uint32(2))

	mock.ExpectQuery("SELECT ts, event, kind, data, turn_seq[\\s\\S]*FROM task_logs_test[\\s\\S]*turn_seq IN \\([\\s\\S]*SELECT DISTINCT turn_seq[\\s\\S]*FROM task_logs_test[\\s\\S]*ORDER BY turn_seq DESC[\\s\\S]*LIMIT \\?[\\s\\S]*ORDER BY turn_seq DESC, ts ASC, msg_seq_start ASC, ingest_id ASC\\s*$").
		WithArgs(taskID, taskID, 2).
		WillReturnRows(chunkRows)

	provider := tasklog.NewClickHouseProvider(clickhouse.NewWithDBAndTable(db, "task_logs_test"))
	resp, err := provider.QueryTurns(context.Background(), taskID, time.Time{}, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Chunks) != 1 {
		t.Fatalf("len(chunks) = %d, want 1", len(resp.Chunks))
	}
	if string(resp.Chunks[0].Data) != "turn-3" {
		t.Fatalf("chunk data = %q, want turn-3", string(resp.Chunks[0].Data))
	}
	if !resp.HasMore {
		t.Fatal("expected has_more=true")
	}
	if resp.NextCursor != "3" {
		t.Fatalf("next_cursor = %q, want 3", resp.NextCursor)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
