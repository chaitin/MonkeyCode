package stats

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

const taskSummary = `jsonb_build_object(
 'total',count(*),
 'completed',count(*) FILTER(WHERE ended_at IS NOT NULL AND NULLIF(failure_code,'') IS NULL AND NULLIF(failure_message,'') IS NULL),
 'failed',count(*) FILTER(WHERE ended_at IS NOT NULL AND (NULLIF(failure_code,'') IS NOT NULL OR NULLIF(failure_message,'') IS NOT NULL)),
 'running',count(*) FILTER(WHERE ended_at IS NULL),
 'completion_rate',100.0*count(*) FILTER(WHERE ended_at IS NOT NULL AND NULLIF(failure_code,'') IS NULL AND NULLIF(failure_message,'') IS NULL)/NULLIF(count(*),0),
 'average_duration_seconds',avg(extract(epoch FROM (ended_at-started_at))))`

func tasks(ctx context.Context, tx pgx.Tx, w window) (resource.Object, error) {
	args := []any{w.from, w.until}
	out, err := resource.Row(ctx, tx, `WITH periods AS (
 SELECT 0 AS n,$1::timestamptz AS start_at,$2::timestamptz AS end_at
 UNION ALL SELECT 1,$1::timestamptz-($2::timestamptz-$1::timestamptz),$1::timestamptz
), totals AS (
 SELECT n,(SELECT `+taskSummary+` FROM sessions s WHERE s.started_at>=p.start_at AND s.started_at<p.end_at AND s.deleted_at IS NULL) AS summary FROM periods p
) SELECT jsonb_build_object('summary',(SELECT summary FROM totals WHERE n=0),'previous',(SELECT summary FROM totals WHERE n=1))`, args...)
	if err != nil {
		return nil, err
	}
	trend, err := resource.Rows(ctx, tx, `WITH buckets AS (
 SELECT generate_series($1::timestamptz,$2::timestamptz-interval '1 microsecond',$3::bigint*interval '1 second') AS at
), totals AS (
 SELECT floor(extract(epoch FROM (started_at-$1::timestamptz))/$3)::bigint AS bucket,
 count(*) FILTER(WHERE ended_at IS NOT NULL AND NULLIF(failure_code,'') IS NULL AND NULLIF(failure_message,'') IS NULL) AS completed,
 count(*) FILTER(WHERE ended_at IS NOT NULL AND (NULLIF(failure_code,'') IS NOT NULL OR NULLIF(failure_message,'') IS NOT NULL)) AS failed,
 count(*) FILTER(WHERE ended_at IS NULL) AS running
 FROM sessions WHERE started_at >= $1 AND started_at < $2 AND deleted_at IS NULL GROUP BY 1
) SELECT jsonb_build_object('at',b.at,'completed',COALESCE(t.completed,0),'failed',COALESCE(t.failed,0),'running',COALESCE(t.running,0))
 FROM buckets b LEFT JOIN totals t ON t.bucket=floor(extract(epoch FROM (b.at-$1::timestamptz))/$3)::bigint ORDER BY b.at`, append(args, int64(w.step.Seconds()))...)
	if err != nil {
		return nil, err
	}
	types, err := resource.Rows(ctx, tx, `SELECT `+taskSummary+`||jsonb_build_object('key',session_type) FROM sessions
 WHERE started_at >= $1 AND started_at < $2 AND deleted_at IS NULL GROUP BY session_type ORDER BY count(*) DESC,session_type`, args...)
	if err != nil {
		return nil, err
	}
	out["trend"], out["types"] = trend, types
	return out, nil
}
