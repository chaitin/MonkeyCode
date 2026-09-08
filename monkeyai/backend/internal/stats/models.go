package stats

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

const modelSummary = `jsonb_build_object(
 'calls',count(*),
 'input_tokens',COALESCE(sum(input_tokens),0),
 'output_tokens',COALESCE(sum(output_tokens),0),
 'cache_hit_rate',100.0*count(*) FILTER(WHERE cache_hit)/NULLIF(count(*),0),
 'success_rate',100.0*count(*) FILTER(WHERE status='succeeded')/NULLIF(count(*) FILTER(WHERE status<>'running'),0))`

func models(ctx context.Context, tx pgx.Tx, w window) (resource.Object, error) {
	args := []any{w.from, w.until, w.model}
	out, err := resource.Row(ctx, tx, `WITH periods AS (
 SELECT 0 AS n,$1::timestamptz AS start_at,$2::timestamptz AS end_at
 UNION ALL SELECT 1,$1::timestamptz-($2::timestamptz-$1::timestamptz),$1::timestamptz
), totals AS (
 SELECT n,(SELECT `+modelSummary+` FROM model_calls c
 WHERE c.started_at>=p.start_at AND c.started_at<p.end_at AND ($3='' OR c.model_id=NULLIF($3,'')::uuid)) ||
 jsonb_build_object('credits',(SELECT COALESCE(-sum(credit_delta),0)::text FROM credit_ledger_entries e
 WHERE e.occurred_at>=p.start_at AND e.occurred_at<p.end_at AND e.category='model'
 AND e.entry_type IN ('charge','refund') AND ($3='' OR e.resource_id=NULLIF($3,'')::uuid))) AS summary
 FROM periods p
) SELECT jsonb_build_object('summary',(SELECT summary FROM totals WHERE n=0),'previous',(SELECT summary FROM totals WHERE n=1))`, args...)
	if err != nil {
		return nil, err
	}
	trend, err := resource.Rows(ctx, tx, `WITH buckets AS (
 SELECT generate_series($1::timestamptz,$2::timestamptz-interval '1 microsecond',$4::bigint*interval '1 second') AS at
), calls AS (
 SELECT floor(extract(epoch FROM (started_at-$1::timestamptz))/$4)::bigint AS bucket,
 count(*) AS calls,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens
 FROM model_calls WHERE started_at >= $1 AND started_at < $2 AND ($3='' OR model_id=NULLIF($3,'')::uuid) GROUP BY 1
), credits AS (
 SELECT floor(extract(epoch FROM (occurred_at-$1::timestamptz))/$4)::bigint AS bucket,-sum(credit_delta) AS credits
 FROM credit_ledger_entries WHERE occurred_at >= $1 AND occurred_at < $2 AND category='model'
 AND entry_type IN ('charge','refund') AND ($3='' OR resource_id=NULLIF($3,'')::uuid) GROUP BY 1
) SELECT jsonb_build_object('at',b.at,'calls',COALESCE(c.calls,0),'input_tokens',COALESCE(c.input_tokens,0),
 'output_tokens',COALESCE(c.output_tokens,0),'credits',COALESCE(e.credits,0)::text)
 FROM buckets b LEFT JOIN calls c ON c.bucket=floor(extract(epoch FROM (b.at-$1::timestamptz))/$4)::bigint
 LEFT JOIN credits e ON e.bucket=floor(extract(epoch FROM (b.at-$1::timestamptz))/$4)::bigint ORDER BY b.at`, append(args, int64(w.step.Seconds()))...)
	if err != nil {
		return nil, err
	}
	options, err := resource.Rows(ctx, tx, `SELECT jsonb_build_object('id',id,'name',display_name,'deleted',deleted_at IS NOT NULL)
 FROM models WHERE deleted_at IS NULL OR id=NULLIF($3,'')::uuid OR id IN (SELECT model_id FROM model_calls WHERE started_at >= $1 AND started_at < $2)
 OR id IN (SELECT resource_id FROM credit_ledger_entries WHERE category='model' AND occurred_at >= $1 AND occurred_at < $2)
 ORDER BY display_name,id`, w.from, w.until, w.model)
	if err != nil {
		return nil, err
	}
	out["trend"], out["models"] = trend, options
	return out, nil
}
