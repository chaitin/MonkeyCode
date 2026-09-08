package stats

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

func realtime(ctx context.Context, tx pgx.Tx, w window) (resource.Object, error) {
	return resource.Row(ctx, tx, `WITH calls AS (
 SELECT * FROM model_calls WHERE completed_at >= $1 AND completed_at < $2
), active_users AS (
 SELECT user_id FROM calls
 UNION SELECT user_id FROM mcp_tool_calls WHERE completed_at >= $1 AND completed_at < $2
 UNION SELECT owner_user_id FROM sessions WHERE last_active_at >= $1 AND last_active_at < $2 AND deleted_at IS NULL
 UNION SELECT user_id FROM billing_transactions WHERE status='running' AND started_at >= $1 AND started_at < $2
) SELECT jsonb_build_object(
 'model_consumption',(SELECT COALESCE(-sum(credit_delta),0)::text FROM credit_ledger_entries WHERE occurred_at >= $1 AND occurred_at < $2 AND category='model' AND entry_type IN ('charge','refund')),
 'p95_response_time',(SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(response_duration_ms,extract(epoch FROM (completed_at-started_at))*1000)) FROM calls WHERE status<>'running'),
 'model_success_rate',(SELECT 100.0*count(*) FILTER(WHERE status='succeeded')/NULLIF(count(*) FILTER(WHERE status<>'running'),0) FROM calls),
 'model_calls',(SELECT count(*) FROM calls),
 'tpm',(SELECT COALESCE(sum(input_tokens+output_tokens),0) FROM calls)/$3::numeric,
 'rpm',(SELECT count(*) FROM calls)/$3::numeric,
 'input_tokens',(SELECT COALESCE(sum(input_tokens),0) FROM calls),
 'output_tokens',(SELECT COALESCE(sum(output_tokens),0) FROM calls),
 'active_users',(SELECT count(*) FROM active_users),
 'active_tasks',(SELECT count(*) FROM sessions WHERE ended_at IS NULL AND last_active_at >= $1 AND last_active_at < $2 AND deleted_at IS NULL),
 'new_tasks',(SELECT count(*) FROM sessions WHERE started_at >= $1 AND started_at < $2 AND deleted_at IS NULL))`, w.from, w.until, w.until.Sub(w.from).Minutes())
}
