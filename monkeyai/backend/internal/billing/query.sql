-- name: SavePolicy :execresult
UPDATE
    settings
SET
    value = sqlc.arg(value)::jsonb || CASE WHEN value ? 'wallet' THEN
        jsonb_build_object('wallet', value -> 'wallet')
    ELSE
        '{}'::jsonb
    END,
    revision = sqlc.arg(revision),
    updated_by_user_id = sqlc.arg(updated_by_user_id),
    updated_at = now()
WHERE
    KEY = 'billing';

-- name: ListGroupQuotas :many
SELECT
    jsonb_build_object('id', g.id, 'parent_id', COALESCE(g.parent_id::text, '00000000-0000-0000-0000-000000000000')::text,
	'name', g.name, 'credits', q.credits_per_cycle::text)
FROM
    GROUPS g
    LEFT JOIN billing_quotas q ON q.group_id = g.id
        AND q.deleted_at IS NULL
WHERE
    g.deleted_at IS NULL
ORDER BY
    g.created_at,
    g.id;

-- name: ListUserQuotas :many
WITH RECURSIVE ancestors AS (
    SELECT
        id child,
        id ancestor,
        parent_id,
        0 depth
    FROM
        GROUPS
    WHERE
        deleted_at IS NULL
    UNION ALL
    SELECT
        a.child,
        g.id,
        g.parent_id,
        a.depth + 1
    FROM
        ancestors a
        JOIN GROUPS g ON g.id = a.parent_id
    WHERE
        g.deleted_at IS NULL
        AND a.depth < 100
),
memberships AS (
    SELECT
        gu.user_id,
        g.id,
        g.created_at,
        COALESCE(q.credits_per_cycle, sqlc.arg(root_credits)::numeric) AS credits,
        COALESCE(q.ancestor::text, sqlc.arg(root_group)::text) AS source
    FROM
        group_users gu
        JOIN groups g ON g.id = gu.group_id AND g.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT b.credits_per_cycle, a.ancestor
            FROM ancestors a
                JOIN billing_quotas b ON b.group_id = a.ancestor AND b.deleted_at IS NULL
            WHERE a.child = g.id
            ORDER BY a.depth
            LIMIT 1
        ) q ON TRUE
    WHERE gu.removed_at IS NULL
)
SELECT
    jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'status', u.status,
        'avatar_url', nullif(btrim(u.avatar_url), ''),
        'group_ids', ARRAY(SELECT m.id::text FROM memberships m WHERE m.user_id = u.id ORDER BY m.created_at, m.id),
        'effective_credits', COALESCE(g.credits, sqlc.arg(root_credits)::numeric)::text,
        'balance_credits', COALESCE(a.balance,
            g.credits, sqlc.arg(root_credits)::numeric)::text,
        'available_credits', COALESCE(a.balance,
            g.credits, sqlc.arg(root_credits)::numeric)::text,
        'inherited_from', COALESCE(g.source, sqlc.arg(root_group)::text),
        'external_user_id', wb.external_user_id)
FROM
    users u
    LEFT JOIN LATERAL (
        SELECT m.credits, m.source
        FROM memberships m
        WHERE m.user_id = u.id
        ORDER BY m.credits DESC, m.created_at, m.id
        LIMIT 1
    ) g ON TRUE
    LEFT JOIN LATERAL (
        SELECT balance
        FROM credit_accounts
        WHERE user_id = u.id
            AND period_start_at = sqlc.arg(period_start_at)
        LIMIT 1
    ) a ON TRUE
    LEFT JOIN wallet_user_bindings wb ON wb.user_id = u.id
WHERE
    u.deleted_at IS NULL
ORDER BY
    u.name,
    u.id;

-- name: WorkspaceName :one
SELECT
    COALESCE((
        SELECT
            NULLIF (value ->> 'workspace_name', '')
        FROM settings
        WHERE
            KEY = 'branding'), 'Monkey AI')::text;

-- name: SetRootQuota :execresult
UPDATE
    settings
SET
    value = jsonb_set(value, '{root_credits}', to_jsonb ($1::text))
WHERE
    KEY = 'billing';

-- name: SubjectExists :one
SELECT
    CASE WHEN sqlc.arg(subject_type)::text = 'group' THEN
        EXISTS (
            SELECT
                1
            FROM
                GROUPS g
            WHERE
                g.id = sqlc.arg(id)
                AND g.deleted_at IS NULL)
    ELSE
        EXISTS (
            SELECT
                1
            FROM
                users u
            WHERE
                u.id = sqlc.arg(id)
                AND u.deleted_at IS NULL)
    END::boolean;

-- name: GetQuota :one
SELECT
    credits_per_cycle::text
FROM
    billing_quotas
WHERE
    subject_type = $2
    AND (group_id = $1
        OR user_id = $1)
    AND deleted_at IS NULL;

-- name: DeleteQuota :execresult
UPDATE
    billing_quotas
SET
    deleted_at = now(),
    updated_at = now()
WHERE
    subject_type = $2
    AND (group_id = $1
        OR user_id = $1)
    AND deleted_at IS NULL;

-- name: CreateQuota :execresult
INSERT INTO billing_quotas (subject_type, group_id, user_id, credits_per_cycle, updated_by_user_id)
    VALUES (sqlc.arg(subject_type), CASE WHEN sqlc.arg(subject_type) = 'group' THEN
            sqlc.arg(subject_id)::uuid
        END, CASE WHEN sqlc.arg(subject_type) = 'user' THEN
            sqlc.arg(subject_id)::uuid
        END, sqlc.arg(credits_per_cycle), sqlc.arg(updated_by_user_id));

-- name: TouchPolicy :execresult
UPDATE
    settings
SET
    revision = revision + 1,
    updated_at = now(),
    updated_by_user_id = $1
WHERE
    KEY = 'billing';

-- name: UpdatePeriodEnd :exec
UPDATE credit_accounts
SET period_end_at = sqlc.arg(period_end_at), updated_at = now()
WHERE period_start_at = sqlc.arg(period_start_at)
    AND period_end_at <> sqlc.arg(period_end_at);

-- name: WalletUser :one
SELECT min(i.provider_subject)::text AS external_user_id
FROM user_identities i
JOIN users u ON u.id = i.user_id AND u.status = 'active' AND u.deleted_at IS NULL
LEFT JOIN wallet_user_bindings wb ON wb.user_id = i.user_id
WHERE i.user_id = $1 AND i.provider = 'baizhiyun' AND i.deleted_at IS NULL
    AND (wb.user_id IS NULL OR wb.external_user_id = i.provider_subject)
GROUP BY i.user_id
HAVING count(DISTINCT i.provider_subject) = 1;

-- name: HasWalletIdentity :one
SELECT EXISTS (
    SELECT 1 FROM user_identities i
    JOIN users u ON u.id = i.user_id AND u.status = 'active' AND u.deleted_at IS NULL
    WHERE i.user_id = $1 AND i.provider_subject = $2
        AND i.provider = 'baizhiyun' AND i.deleted_at IS NULL
)::boolean;

-- name: GetAdjustment :one
WITH locations AS MATERIALIZED (
    SELECT k.id,k.occurred_at FROM credit_ledger_entry_keys k WHERE k.event_key=$1
    UNION ALL
    SELECT original.id,original.occurred_at FROM billing_ledger_original_entries original WHERE original.event_key=$1
        AND (SELECT phase FROM billing_ledger_partition_state)='backfill'
        AND NOT EXISTS(SELECT 1 FROM credit_ledger_entry_keys existing WHERE existing.event_key=$1)
)
SELECT e.credit_delta::text AS credit_delta, e.item_name FROM locations l
CROSS JOIN LATERAL (SELECT * FROM credit_ledger_entries e WHERE e.id=l.id AND e.occurred_at=l.occurred_at OFFSET 0) e;

-- name: AdjustBalance :execresult
UPDATE
    credit_accounts
SET
    balance = balance + $2
WHERE
    id = $1;

-- name: LockRefund :one
SELECT
    account_id,
    MODE,
    status,
    amount::text,
    category,
    item_name
FROM
    billing_transactions
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
FOR UPDATE;

-- name: EventExists :one
WITH locations AS MATERIALIZED (
    SELECT k.id,k.occurred_at FROM credit_ledger_entry_keys k WHERE k.event_key=$1
    UNION ALL
    SELECT original.id,original.occurred_at FROM billing_ledger_original_entries original WHERE original.event_key=$1
        AND (SELECT phase FROM billing_ledger_partition_state)='backfill'
        AND NOT EXISTS(SELECT 1 FROM credit_ledger_entry_keys existing WHERE existing.event_key=$1)
)
SELECT EXISTS(SELECT 1 FROM locations);

-- name: EventID :one
WITH locations AS MATERIALIZED (
    SELECT k.id,k.occurred_at FROM credit_ledger_entry_keys k WHERE k.event_key=$1
    UNION ALL
    SELECT original.id,original.occurred_at FROM billing_ledger_original_entries original WHERE original.event_key=$1
        AND (SELECT phase FROM billing_ledger_partition_state)='backfill'
        AND NOT EXISTS(SELECT 1 FROM credit_ledger_entry_keys existing WHERE existing.event_key=$1)
)
SELECT id FROM locations;

-- name: LockBalance :one
SELECT
    balance::text
FROM
    credit_accounts
WHERE
    id = $1
FOR UPDATE;

-- name: CountEntries :one
SELECT
    count(*)
FROM
    credit_ledger_entries e
WHERE (sqlc.arg(user_query)::text = ''
    OR COALESCE(e.user_name, '')
    ILIKE '%' || sqlc.arg(user_query)::text || '%'
    OR COALESCE(e.user_email, '')
    ILIKE '%' || sqlc.arg(user_query)::text || '%')
AND (sqlc.arg(content_query)::text = ''
    OR e.item_name ILIKE '%' || sqlc.arg(content_query)::text || '%')
AND (sqlc.arg(category)::text = ''
    OR e.category = sqlc.arg(category)::text)
AND (sqlc.arg(MODE)::text = ''
    OR e.mode = sqlc.arg(MODE)::text)
AND (sqlc.arg(entry_type)::text = ''
    OR e.entry_type = sqlc.arg(entry_type)::text)
AND e.occurred_at >= coalesce(sqlc.narg(from_time)::timestamptz, '-infinity'::timestamptz)
AND e.occurred_at < coalesce(sqlc.narg(until_time)::timestamptz, 'infinity'::timestamptz)
AND (sqlc.arg(group_id)::text = ''
    OR e.group_id = NULLIF (sqlc.arg(group_id)::text::text, '')::uuid);

-- name: ListEntries :many
SELECT
    (to_jsonb (e) || jsonb_build_object('credit_delta', e.credit_delta::text, 'balance_after', e.balance_after::text,
	'unit_credits', e.unit_credits::text, 'sequence', e.sequence::text,
    'user_avatar_url', nullif(btrim(u.avatar_url), '')))::jsonb
FROM
    credit_ledger_entries e LEFT JOIN users u ON u.id = e.user_id
WHERE (sqlc.arg(user_query)::text = ''
    OR COALESCE(e.user_name, '')
    ILIKE '%' || sqlc.arg(user_query)::text || '%'
    OR COALESCE(e.user_email, '')
    ILIKE '%' || sqlc.arg(user_query)::text || '%')
AND (sqlc.arg(content_query)::text = ''
    OR e.item_name ILIKE '%' || sqlc.arg(content_query)::text || '%')
AND (sqlc.arg(category)::text = ''
    OR e.category = sqlc.arg(category)::text)
AND (sqlc.arg(MODE)::text = ''
    OR e.mode = sqlc.arg(MODE)::text)
AND (sqlc.arg(entry_type)::text = ''
    OR e.entry_type = sqlc.arg(entry_type)::text)
AND e.occurred_at >= coalesce(sqlc.narg(from_time)::timestamptz, '-infinity'::timestamptz)
AND e.occurred_at < coalesce(sqlc.narg(until_time)::timestamptz, 'infinity'::timestamptz)
AND (sqlc.arg(group_id)::text = ''
    OR e.group_id = NULLIF (sqlc.arg(group_id)::text::text, '')::uuid)
ORDER BY
    e.occurred_at DESC,
    e.id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: CountUserEntries :one
SELECT count(*)
FROM credit_ledger_entries e
WHERE e.user_id = sqlc.arg(user_id)
    AND e.entry_type IN ('charge', 'refund')
    AND (sqlc.arg(content_query)::text = '' OR e.item_name ILIKE '%' || sqlc.arg(content_query)::text || '%')
    AND (sqlc.arg(category)::text = '' OR e.category = sqlc.arg(category)::text)
    AND (sqlc.arg(mode)::text = '' OR e.mode = sqlc.arg(mode)::text)
    AND (sqlc.arg(entry_type)::text = '' OR e.entry_type = sqlc.arg(entry_type)::text)
    AND e.occurred_at >= coalesce(sqlc.narg(from_time)::timestamptz, '-infinity'::timestamptz)
    AND e.occurred_at < coalesce(sqlc.narg(until_time)::timestamptz, 'infinity'::timestamptz);

-- name: ListUserEntries :many
SELECT jsonb_build_object(
    'id', e.id, 'transaction_id', e.transaction_id,
    'entry_type', e.entry_type, 'category', e.category, 'item_name', e.item_name,
    'credit_delta', e.credit_delta::text, 'balance_after', e.balance_after::text,
    'mode', e.mode, 'occurred_at', e.occurred_at)
FROM credit_ledger_entries e
WHERE e.user_id = sqlc.arg(user_id)
    AND e.entry_type IN ('charge', 'refund')
    AND (sqlc.arg(content_query)::text = '' OR e.item_name ILIKE '%' || sqlc.arg(content_query)::text || '%')
    AND (sqlc.arg(category)::text = '' OR e.category = sqlc.arg(category)::text)
    AND (sqlc.arg(mode)::text = '' OR e.mode = sqlc.arg(mode)::text)
    AND (sqlc.arg(entry_type)::text = '' OR e.entry_type = sqlc.arg(entry_type)::text)
    AND e.occurred_at >= coalesce(sqlc.narg(from_time)::timestamptz, '-infinity'::timestamptz)
    AND e.occurred_at < coalesce(sqlc.narg(until_time)::timestamptz, 'infinity'::timestamptz)
ORDER BY e.occurred_at DESC, e.id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: SummarizeEntries :one
SELECT
    jsonb_build_object('charges', COALESCE(- sum(credit_delta) FILTER (WHERE entry_type = 'charge'),
	0)::text, 'refunds', COALESCE(sum(credit_delta) FILTER (WHERE entry_type = 'refund'), 0)::text,
	'net_consumption', COALESCE(- sum(credit_delta) FILTER (WHERE entry_type IN ('charge', 'refund')),
	0)::text, 'count', count(*))
FROM
    credit_ledger_entries e
WHERE (sqlc.arg(user_query)::text = ''
    OR COALESCE(e.user_name, '')
    ILIKE '%' || sqlc.arg(user_query)::text || '%'
    OR COALESCE(e.user_email, '')
    ILIKE '%' || sqlc.arg(user_query)::text || '%')
AND (sqlc.arg(content_query)::text = ''
    OR e.item_name ILIKE '%' || sqlc.arg(content_query)::text || '%')
AND (sqlc.arg(category)::text = ''
    OR e.category = sqlc.arg(category)::text)
AND (sqlc.arg(MODE)::text = ''
    OR e.mode = sqlc.arg(MODE)::text)
AND (sqlc.arg(entry_type)::text = ''
    OR e.entry_type = sqlc.arg(entry_type)::text)
AND e.occurred_at >= coalesce(sqlc.narg(from_time)::timestamptz, '-infinity'::timestamptz)
AND e.occurred_at < coalesce(sqlc.narg(until_time)::timestamptz, 'infinity'::timestamptz)
AND (sqlc.arg(group_id)::text = ''
    OR e.group_id = NULLIF (sqlc.arg(group_id)::text::text, '')::uuid);

-- name: GetTransaction :one
SELECT
    (to_jsonb (t) || jsonb_build_object('reserve', reserve::text, 'amount', amount::text, 'raw_amount',
	raw_amount::text))::jsonb
FROM
    billing_transactions t
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: TransactionEntries :many
SELECT
    (to_jsonb (e) || jsonb_build_object('credit_delta', credit_delta::text, 'balance_after', balance_after::text))::jsonb
FROM
    credit_ledger_entries e
WHERE
    transaction_id = $1
ORDER BY
    SEQUENCE;

-- name: TransactionWalletRecords :many
SELECT
    jsonb_build_object('biz_id', biz_id, 'status', status, 'external_user_id', external_user_id,
	'base_url', base_url, 'app_id', app_id, 'frozen_amount_quota', frozen_amount_quota::text,
	'actual_amount_quota', actual_amount_quota::text, 'error_code', error_code, 'trace_id', trace_id,
	'confirmed_at', confirmed_at)
FROM
    wallet_billing_records
WHERE
    transaction_id = $1;

-- name: PendingTransactions :many
SELECT
    jsonb_build_object('id', t.id, 'user_id', t.user_id, 'user_name', t.user_name, 'user_email',
    t.user_email, 'user_avatar_url', nullif(btrim(u.avatar_url), ''),
    'item_name', t.item_name, 'category', t.category, 'mode', t.mode, 'status',
    t.status, 'reserve', t.reserve::text, 'amount', t.amount::text, 'error_code', t.error_code,
    'attempts', t.attempts, 'started_at', t.started_at)
FROM
    billing_transactions t LEFT JOIN users u ON u.id = t.user_id
WHERE
    t.status NOT IN ('settled', 'released', 'rejected')
ORDER BY
    t.started_at,
    t.id
LIMIT $1 OFFSET $2;

-- name: CountPendingTransactions :one
SELECT
    count(*)
FROM
    billing_transactions
WHERE
    status NOT IN ('settled', 'released', 'rejected');

-- name: AccountDifferences :many
SELECT
    jsonb_build_object('account_id', a.id, 'user_id', a.user_id, 'balance', a.balance::text,
	'ledger_balance', COALESCE(l.balance, 0)::text, 'frozen', a.frozen::text)
FROM
    credit_accounts a
    LEFT JOIN (
        SELECT
            account_id,
            sum(credit_delta) balance
        FROM
            credit_ledger_entries
        GROUP BY
            account_id) l ON l.account_id = a.id
WHERE
    a.balance <> COALESCE(l.balance, 0)
    OR a.frozen <> 0
ORDER BY
    a.created_at
LIMIT 100;

-- name: MigrationIssues :many
SELECT
    to_jsonb (i)
FROM
    billing_migration_issues i
ORDER BY
    id
LIMIT 100;

-- name: TransactionStatus :one
SELECT
    status
FROM
    billing_transactions
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: LockTransactionStatus :one
SELECT
    status,
    MODE,
    category,
    usage,
    request_id
FROM
    billing_transactions
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
FOR UPDATE;

-- name: ImageJobReview :one
SELECT job.id, job.requested_images, count(output.id)::bigint AS archived_images
FROM image_jobs job LEFT JOIN image_outputs output ON output.job_id = job.id
WHERE job.billing_transaction_id = $1 AND job.status = 'unknown'
GROUP BY job.id;

-- name: ResolveImageJob :execrows
UPDATE image_jobs
SET status = sqlc.arg(status)::text,
    generated_images = sqlc.arg(generated_images)::integer,
    error_code = sqlc.arg(error_code)::text,
    completed_at = now()
WHERE billing_transaction_id = sqlc.arg(billing_transaction_id)::uuid AND status = 'unknown';

-- name: WalletStatus :one
SELECT
    status
FROM
    wallet_billing_records
WHERE
    transaction_id = $1;

-- name: InitializePolicy :execresult
INSERT INTO settings (KEY, value, updated_by_user_id)
SELECT
    'billing',
    $1,
    id
FROM
    users
WHERE
    ROLE = 'admin'
    AND deleted_at IS NULL
ORDER BY
    created_at
LIMIT 1
ON CONFLICT (KEY)
    DO NOTHING;

-- name: LockAccount :one
SELECT
    id,
    user_id,
    COALESCE(group_id::text, '')::text AS group_id,
    balance::text,
    frozen::text,
    QUOTA::text,
    period_start_at,
    period_end_at,
    sequence
FROM
    credit_accounts
WHERE
    user_id = $1
    AND period_start_at = $2
FOR UPDATE;

-- name: EffectiveQuota :one
WITH RECURSIVE chain AS (
    SELECT
        g.id AS member_id,
        g.id,
        g.parent_id,
        g.created_at,
        0 AS depth
    FROM group_users gu
        JOIN groups g ON g.id = gu.group_id AND g.deleted_at IS NULL
    WHERE gu.user_id = sqlc.arg(id) AND gu.removed_at IS NULL
    UNION ALL
    SELECT c.member_id, g.id, g.parent_id, c.created_at, c.depth + 1
    FROM chain c
        JOIN groups g ON g.id = c.parent_id
    WHERE g.deleted_at IS NULL AND c.depth < 100
),
root AS (
    SELECT COALESCE((SELECT (value ->> 'root_credits')::numeric FROM settings WHERE key = 'billing'), 10000) AS credits
),
choices AS (
    SELECT c.id, c.created_at,
        COALESCE(q.credits_per_cycle, root.credits) AS credits,
        COALESCE(q.source, sqlc.arg(root_group)::text) AS source
    FROM chain c
        CROSS JOIN root
        LEFT JOIN LATERAL (
            SELECT b.credits_per_cycle, a.id::text AS source
            FROM chain a
                JOIN billing_quotas b ON b.group_id = a.id AND b.deleted_at IS NULL
            WHERE a.member_id = c.id
            ORDER BY a.depth
            LIMIT 1
        ) q ON TRUE
    WHERE c.depth = 0
)
SELECT
    COALESCE(g.credits, root.credits)::text AS credits,
    COALESCE(g.id::text, '')::text AS group_id,
    COALESCE(g.source, sqlc.arg(root_group)::text)::text AS source
FROM root
    LEFT JOIN LATERAL (
        SELECT id, credits, source FROM choices
        ORDER BY credits DESC, created_at, id
        LIMIT 1
    ) g ON TRUE;

-- name: LockGroupsForReset :execresult
SELECT pg_advisory_xact_lock(741209);

-- name: ResetTargetsExist :one
SELECT
    (SELECT count(*) FROM groups WHERE id = ANY(sqlc.arg(group_ids)::uuid[]) AND deleted_at IS NULL) = cardinality(sqlc.arg(group_ids)::uuid[]) AS groups_exist,
    (SELECT count(*) FROM users WHERE id = ANY(sqlc.arg(user_ids)::uuid[]) AND deleted_at IS NULL) = cardinality(sqlc.arg(user_ids)::uuid[]) AS users_exist;

-- name: ImmediateResetUsers :many
WITH RECURSIVE descendants(id) AS (
    SELECT id FROM groups
    WHERE id = ANY(sqlc.arg(group_ids)::uuid[]) AND deleted_at IS NULL
    UNION
    SELECT g.id FROM groups g
    JOIN descendants d ON g.parent_id = d.id
    WHERE g.deleted_at IS NULL
), selected_users(id) AS (
    SELECT unnest(sqlc.arg(user_ids)::uuid[])
    UNION
    SELECT gu.user_id FROM group_users gu
    JOIN descendants d ON d.id = gu.group_id
    WHERE gu.removed_at IS NULL
    UNION
    SELECT id FROM users WHERE sqlc.arg(include_root)::boolean
)
SELECT u.id
FROM users u
JOIN selected_users selected ON selected.id = u.id
WHERE u.deleted_at IS NULL
ORDER BY u.id;

-- name: GetImmediateReset :one
SELECT
    COALESCE(metadata ->> 'request_hash', '')::text AS request_hash,
    COALESCE((metadata ->> 'reset_count')::bigint, 0)::bigint AS reset_count
FROM credit_ledger_entries
WHERE event_key = $1;

-- name: LockUser :one
SELECT
    id
FROM
    users
WHERE
    id = $1
    AND deleted_at IS NULL
FOR UPDATE;

-- name: CreateAccount :one
INSERT INTO credit_accounts (user_id, balance, QUOTA, group_id, period_start_at, period_end_at, last_refreshed_at)
    VALUES (sqlc.arg(user_id), sqlc.arg(balance), sqlc.arg(balance), NULLIF
	(sqlc.arg(group_id)::text, '')::uuid, sqlc.arg(period_start_at), sqlc.arg(period_end_at),
	sqlc.arg(last_refreshed_at))
RETURNING
    id;

-- name: SetAccountQuotaBalance :execresult
UPDATE credit_accounts
SET balance = sqlc.arg(balance),
    quota = sqlc.arg(balance),
    group_id = NULLIF(sqlc.arg(group_id)::text, '')::uuid,
    last_refreshed_at = sqlc.arg(refreshed_at),
    updated_at = now()
WHERE id = sqlc.arg(id);

-- name: AppendLedger :execresult
WITH a AS (
    UPDATE
        credit_accounts ca
    SET
        SEQUENCE =
            ca.sequence + 1,
            updated_at = now()
        WHERE
            ca.id = sqlc.arg(id)
        RETURNING
            ca.*)
    INSERT INTO credit_ledger_entries (account_id, user_id, transaction_id, event_key, SEQUENCE,
        entry_type,
        category,
        item_name,
        credit_delta,
        balance_after,
        occurred_at,
        user_name,
        user_email,
        group_id,
        MODE,
        metadata,
        reverses_id
)
SELECT
    a.id,
    a.user_id,
    NULLIF (sqlc.arg(transaction_id)::text, '')::uuid,
    sqlc.arg(event_key),
    a.sequence,
    sqlc.arg(entry_type),
    sqlc.arg(category),
    sqlc.arg(item_name),
    sqlc.arg(credit_delta),
    a.balance,
    now(),
    COALESCE(t.user_name, u.name),
    COALESCE(t.user_email, u.email),
    a.group_id,
    sqlc.arg(mode),
    sqlc.arg(metadata),
    NULLIF (sqlc.arg(metadata)::jsonb ->> 'reverses_id', '')::uuid
FROM
    a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN billing_transactions t ON t.id = NULLIF (sqlc.arg(transaction_id)::text, '')::uuid
        AND t.started_at = (SELECT billing_activity_time('billing_transactions',NULLIF(sqlc.arg(transaction_id)::text,'')::uuid));

-- name: SharePolicy :one
SELECT
    revision
FROM
    settings
WHERE
    KEY = 'billing' FOR SHARE;

-- name: UsersWithoutAccount :many
SELECT
    id
FROM
    users u
WHERE
    deleted_at IS NULL
    AND NOT EXISTS (
        SELECT
            1
        FROM
            credit_accounts a
        WHERE
            a.user_id = u.id
            AND a.period_start_at = $1)
ORDER BY
    id;

-- name: BillingUser :one
SELECT
    name,
    email,
    status
FROM
    users
WHERE
    id = $1;

-- name: IdempotentTransaction :one
WITH identity AS (
    SELECT k.id,k.partition_at FROM billing_transactions_keys k WHERE k.user_id=$1 AND k.category=$2 AND k.idempotency_key=$3
    UNION ALL
    SELECT o.id,o.started_at FROM billing_transactions_original o WHERE o.user_id=$1 AND o.category=$2 AND o.idempotency_key=$3
        AND (SELECT billing_activity_backfilling('billing_transactions'))
        AND NOT EXISTS(SELECT 1 FROM billing_transactions_keys registered WHERE registered.user_id=$1 AND registered.category=$2 AND registered.idempotency_key=$3)
)
SELECT t.id,t.request_hash FROM identity k CROSS JOIN LATERAL (
    SELECT id,request_hash FROM billing_transactions WHERE id=k.id AND started_at=k.partition_at OFFSET 0
) t;

-- name: SessionOwned :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            sessions
        WHERE
            id = $1
            AND owner_user_id = $2
            AND deleted_at IS NULL);

-- name: ModelPricing :one
SELECT
    ownership_type,
    display_name,
    credit_multiplier::text,
    COALESCE((advanced_config ->> 'context_window_tokens')::bigint, 0)::bigint AS context_window_tokens,
    COALESCE((advanced_config ->> 'max_output_tokens')::bigint, 0)::bigint AS max_output_tokens
FROM
    models
WHERE
    id = $1
    AND enabled
    AND deleted_at IS NULL;

-- name: ImageCharge :one
SELECT amount::text FROM billing_transactions
WHERE id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid)) AND user_id = $2 AND category = 'image'
    AND amount IS NOT NULL AND status IN ('settled', 'released');

-- name: ImagePricingModel :one
SELECT ownership_type, display_name
FROM models
WHERE id = $1 AND kind = 'image' AND enabled AND deleted_at IS NULL;

-- name: VideoPricingModel :one
SELECT display_name, ownership_type FROM models
WHERE id=$1 AND kind='video' AND enabled AND deleted_at IS NULL;

-- name: VideoCharge :one
SELECT COALESCE(raw_amount, 0)::text AS raw_amount, status, error_code FROM billing_transactions
WHERE id=$1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid)) AND user_id=$2 AND category='video';

-- name: UpsertVideoCall :exec
INSERT INTO video_calls (id, job_id, billing_transaction_id, user_id, model_id, session_id, status, output_duration_ms, created_at)
SELECT COALESCE((SELECT id FROM video_calls_keys WHERE job_id=j.id), (SELECT id FROM video_calls_original WHERE job_id=j.id AND (SELECT billing_activity_backfilling('video_calls'))), j.id),
    j.id, t.id, t.user_id, t.resource_id, t.session_id, sqlc.arg(result)::text, sqlc.arg(duration_ms)::bigint,
    COALESCE((SELECT partition_at FROM video_calls_keys WHERE job_id=j.id), (SELECT created_at FROM video_calls_original WHERE job_id=j.id AND (SELECT billing_activity_backfilling('video_calls'))), j.created_at)
FROM billing_transactions t JOIN video_jobs j ON j.billing_transaction_id=t.id WHERE t.id=sqlc.arg(transaction_id)::uuid
    AND t.started_at=(SELECT billing_activity_time('billing_transactions',sqlc.arg(transaction_id)::uuid))
ON CONFLICT (job_id,created_at) DO UPDATE SET status=EXCLUDED.status, output_duration_ms=EXCLUDED.output_duration_ms;

-- name: ToolPricing :one
SELECT
    t.name,
    t.credits_per_call::text,
    c.authorization_mode,
    c.ownership_type
FROM
    mcp_tools t
    JOIN connectors c ON c.id = t.connector_id
WHERE
    t.id = sqlc.arg(id)
    AND c.id = sqlc.arg(connector_id)
    AND t.enabled
    AND t.deleted_at IS NULL
    AND c.deleted_at IS NULL;

-- name: CreateTransaction :execresult
INSERT INTO billing_transactions (id, user_id, account_id, session_id, category, resource_id, connector_id, item_name,
    user_name, user_email, group_id, MODE, status, reserve, pricing, idempotency_key, request_hash, started_at)
    VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(account_id), NULLIF
	(sqlc.arg(session_id)::text, '')::UUID,sqlc.arg(category),sqlc.arg(resource_id),NULLIF(sqlc.arg(connector_id)::text,'')::uuid, sqlc.arg(item_name), sqlc.arg(user_name),
	sqlc.arg(user_email), NULLIF (sqlc.arg(group_id)::text, '')::UUID,sqlc.arg(mode),sqlc.arg(status),sqlc.arg(reserve),sqlc.arg(pricing),NULLIF(sqlc.arg(idempotency_key)::text,''), sqlc.arg(request_hash),
	sqlc.arg(started_at));

-- name: CreateWalletRecord :execresult
INSERT INTO wallet_billing_records (biz_id, transaction_id, external_user_id, team_slug, base_url, app_id, status,
    frozen_amount_quota)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7);

-- name: StartTransaction :execresult
UPDATE
    billing_transactions
SET
    status = 'running',
    updated_at = now()
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
    AND status = 'reserved';

-- name: LockUsage :one
SELECT
    account_id,
    category,
    MODE,
    status,
    reserve::text,
    pricing
FROM
    billing_transactions
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
FOR UPDATE;

-- name: SaveUsage :execresult
UPDATE
    billing_transactions
SET
    status = $2,
    amount = $3,
    raw_amount = $4,
    USAGE = $5,
    RESULT = $6,
    error_code = $7,
    request_id = $8,
    completed_at = $9,
    updated_at = now(),
    next_retry_at = now()
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: UpsertModelCall :execresult
INSERT INTO model_calls (id, session_id, user_id, model_id, request_id, status, input_tokens, cached_input_tokens,
    output_tokens, cache_hit, error_code, started_at, completed_at, first_token_duration_ms)
SELECT
    id,
    session_id,
    user_id,
    resource_id,
    NULLIF (request_id, ''),
    RESULT,
    sqlc.arg(input_tokens)::bigint,
    sqlc.arg(cached_input_tokens)::bigint,
    sqlc.arg(output_tokens)::bigint,
    sqlc.arg(cached_input_tokens)::bigint > 0,
    NULLIF (error_code, ''),
    COALESCE((SELECT billing_activity_time('model_calls',bt.id)), bt.started_at),
    completed_at,
    sqlc.narg(first_token_duration_ms)::integer
FROM
    billing_transactions bt
WHERE
    bt.id = sqlc.arg(id) AND bt.started_at=(SELECT billing_activity_time('billing_transactions',sqlc.arg(id)::uuid))
ON CONFLICT (id,started_at)
    DO UPDATE SET
        status = EXCLUDED.status,
        input_tokens = EXCLUDED.input_tokens,
        cached_input_tokens = EXCLUDED.cached_input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cache_hit = EXCLUDED.cache_hit,
        error_code = EXCLUDED.error_code,
        completed_at = EXCLUDED.completed_at,
        first_token_duration_ms = COALESCE(EXCLUDED.first_token_duration_ms, model_calls.first_token_duration_ms);

-- name: UpsertImageCall :execresult
INSERT INTO image_calls (id, user_id, model_id, request_id, status, generated_images, error_code,
    started_at, completed_at, billing_transaction_id, job_id, session_id)
SELECT bt.id, bt.user_id, bt.resource_id, NULLIF(bt.request_id, ''), bt.result, sqlc.arg(generated_images)::bigint,
    NULLIF(bt.error_code, ''), COALESCE((SELECT billing_activity_time('image_calls',bt.id)), bt.started_at), bt.completed_at, bt.id,
    (SELECT job.id FROM image_jobs job WHERE job.billing_transaction_id = bt.id), bt.session_id
FROM billing_transactions bt
WHERE bt.id = sqlc.arg(id) AND bt.started_at=(SELECT billing_activity_time('billing_transactions',sqlc.arg(id)::uuid))
ON CONFLICT (id,started_at) DO UPDATE SET
    status = EXCLUDED.status,
    generated_images = EXCLUDED.generated_images,
    error_code = EXCLUDED.error_code,
    completed_at = EXCLUDED.completed_at,
    billing_transaction_id = EXCLUDED.billing_transaction_id,
    job_id = COALESCE(EXCLUDED.job_id, image_calls.job_id),
    session_id = COALESCE(EXCLUDED.session_id, image_calls.session_id);

-- name: UpsertToolCall :execresult
INSERT INTO mcp_tool_calls (id, session_id, user_id, connector_id, tool_id, request_id, status, error_code, started_at,
    completed_at)
SELECT
    id,
    session_id,
    user_id,
    connector_id,
    resource_id,
    NULLIF (request_id, ''),
    RESULT,
    NULLIF (error_code, ''),
    COALESCE((SELECT billing_activity_time('mcp_tool_calls',bt.id)), bt.started_at),
    completed_at
FROM
    billing_transactions bt
WHERE
    bt.id = $1 AND bt.started_at=(SELECT billing_activity_time('billing_transactions',$1::uuid))
ON CONFLICT (id,started_at)
    DO UPDATE SET
        status = EXCLUDED.status,
        error_code = EXCLUDED.error_code,
        completed_at = EXCLUDED.completed_at;

-- name: TrySettlementLock :one
SELECT
    pg_try_advisory_lock(hashtextextended($1, 41));

-- name: ReleaseSettlementLock :execresult
SELECT
    pg_advisory_unlock(hashtextextended($1, 41));

-- name: TryReconciliationLock :one
SELECT
    pg_try_advisory_lock(hashtextextended($1, 42));

-- name: ReleaseReconciliationLock :execresult
SELECT
    pg_advisory_unlock(hashtextextended($1, 42));

-- name: SettlementStatus :one
SELECT
    MODE,
    status
FROM
    billing_transactions
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: LockSettlement :one
SELECT
    account_id,
    item_name,
    category,
    amount::text,
    status
FROM
    billing_transactions
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
FOR UPDATE;

-- name: ChargeBalance :execresult
UPDATE
    credit_accounts
SET
    balance = balance - $2,
    updated_at = now()
WHERE
    id = $1;

-- name: CompleteSettlement :execresult
UPDATE
    billing_transactions
SET
    status = CASE WHEN amount = 0
        AND RESULT <> 'succeeded' THEN
        'released'
    ELSE
        'settled'
    END,
    error_code = '',
    next_retry_at = NULL,
    updated_at = now()
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: MarkInterrupted :execresult
UPDATE
    billing_transactions
SET
    status = 'unknown',
    error_code = 'execution_interrupted',
    updated_at = now()
WHERE
    status IN ('running', 'reserved', 'created')
    AND updated_at < now() - interval '30 minutes';

-- name: TransactionsToRetry :many
SELECT
    id
FROM
    billing_transactions
WHERE
    status = 'settling'
    AND (next_retry_at IS NULL
        OR next_retry_at <= now())
ORDER BY
    started_at
LIMIT 100;

-- name: ScheduleRetry :execresult
UPDATE
    billing_transactions
SET
    attempts = attempts + 1,
    next_retry_at = now() + make_interval(secs => LEAST (3600, 30 * power(2, LEAST (attempts, 7)))::int)
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
    AND status IN ('settling', 'unknown');

-- name: TransactionsToReconcile :many
SELECT
    id,
    resource_id,
    request_id,
    USAGE,
    error_code,
    attempts
FROM
    billing_transactions
WHERE
    status = 'unknown'
    AND category = 'model'
    AND request_id <> ''
    AND next_retry_at IS NOT NULL
    AND next_retry_at <= now()
    AND (error_code = 'usage_unknown'
        OR error_code = 'usage_missing'
        OR error_code = 'usage_incomplete'
        OR error_code = 'usage_parse_failed'
        OR error_code = 'usage_read_failed'
        OR error_code = 'usage_terminal_event_missing'
        OR error_code = 'stream_interrupted'
        OR error_code = 'upstream_error_event')
ORDER BY
    started_at
LIMIT 100;

-- name: StopReconciliation :execresult
UPDATE
    billing_transactions
SET
    next_retry_at = NULL,
    updated_at = now()
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
    AND status = 'unknown';

-- name: ActiveUsersWithoutAccount :many
SELECT
    id
FROM
    users u
WHERE
    status = 'active'
    AND deleted_at IS NULL
    AND NOT EXISTS (
        SELECT
            1
        FROM
            credit_accounts a
        WHERE
            a.user_id = u.id
            AND a.period_start_at = $1)
ORDER BY
    id
LIMIT 100;

-- name: WalletReservation :one
SELECT
    biz_id,
    external_user_id,
    base_url,
    app_id,
    frozen_amount_quota
FROM
    wallet_billing_records
WHERE
    transaction_id = $1;

-- name: SetWalletTeam :execresult
UPDATE
    wallet_billing_records
SET
    team_slug = $2
WHERE
    transaction_id = $1;

-- name: SetWalletStatus :execresult
UPDATE
    wallet_billing_records
SET
    status = $2,
    error_code = $3,
    trace_id = $4,
    updated_at = now()
WHERE
    transaction_id = $1;

-- name: SetTransactionStatus :execresult
UPDATE
    billing_transactions
SET
    status = $2,
    error_code = $3,
    updated_at = now()
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: MarkWalletReserved :execresult
UPDATE
    wallet_billing_records
SET
    status = 'reserved',
    updated_at = now()
WHERE
    transaction_id = $1;

-- name: MarkReserved :execresult
UPDATE
    billing_transactions
SET
    status = 'reserved',
    updated_at = now()
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid))
    AND status = 'created';

-- name: WalletConfirmation :one
SELECT
    w.biz_id,
    w.external_user_id,
    w.team_slug,
    w.base_url,
    w.app_id,
    w.status,
    t.item_name,
    t.amount::text
FROM
    wallet_billing_records w
    JOIN billing_transactions t ON t.id = w.transaction_id
WHERE
    t.id = $1 AND t.started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: MarkWalletConfirming :execresult
UPDATE
    wallet_billing_records
SET
    status = 'confirming',
    actual_amount_quota = $2,
    confirmation_status = 'success',
    updated_at = now()
WHERE
    transaction_id = $1;

-- name: SetWalletError :execresult
UPDATE
    wallet_billing_records
SET
    error_code = $2,
    trace_id = $3,
    updated_at = now()
WHERE
    transaction_id = $1;

-- name: SetTransactionError :execresult
UPDATE
    billing_transactions
SET
    error_code = $2
WHERE
    id = $1 AND started_at = (SELECT billing_activity_time('billing_transactions',$1::uuid));

-- name: MarkWalletConfirmed :execresult
UPDATE
    wallet_billing_records
SET
    status = 'confirmed',
    error_code = '',
    confirmed_at = now(),
    updated_at = now()
WHERE
    transaction_id = $1;

-- name: HasPendingWalletTransactions :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            billing_transactions
        WHERE
            user_id = $1
            AND MODE = 'remote'
            AND status NOT IN ('settled', 'released', 'rejected'));

-- name: BindWalletUser :execresult
INSERT INTO wallet_user_bindings (user_id, external_user_id, verified_at, updated_by_user_id)
    VALUES ($1, $2, now(), $3)
ON CONFLICT (user_id)
    DO UPDATE SET
        external_user_id = EXCLUDED.external_user_id,
        verified_at = now(),
        updated_by_user_id = EXCLUDED.updated_by_user_id;

-- name: GetPolicy :one
-- 预留事务持有共享锁，避免连接切换漏查尚未提交的远程交易。
SELECT
    *
FROM
    settings
WHERE
    KEY = 'billing'
FOR SHARE;

-- name: LockPolicy :one
SELECT
    *
FROM
    settings
WHERE
    KEY = 'billing'
FOR UPDATE;

-- name: SaveWalletConfig :execresult
UPDATE settings
SET value = jsonb_set(value, '{wallet}', $1::jsonb)
WHERE key = 'billing';

-- name: HasOtherWalletTransactions :one
SELECT EXISTS (
    SELECT 1
    FROM wallet_billing_records w
    JOIN billing_transactions t ON t.id = w.transaction_id
    WHERE t.status NOT IN ('settled', 'released', 'rejected')
        AND (w.base_url <> $1 OR w.app_id <> $2)
);

-- name: EnsureActivityWeeks :one
SELECT billing_ensure_activity_weeks(sqlc.arg(table_name)::text,sqlc.arg(at_time)::timestamptz)::boolean;

-- name: CopyActivityBatch :one
SELECT billing_copy_activity_batch(sqlc.arg(table_name)::text,1000)::integer;

-- name: CutoverActivity :one
SELECT billing_cutover_activity(sqlc.arg(table_name)::text)::boolean;

-- name: EnsureLedgerWeeks :one
SELECT billing_ensure_ledger_weeks(sqlc.arg(at)::timestamptz)::boolean;

-- name: CopyLedgerBatch :one
SELECT billing_copy_ledger_batch(sqlc.arg(batch_size)::integer)::integer;

-- name: CutoverLedger :one
SELECT billing_cutover_ledger()::boolean;

-- name: LedgerDefaultCount :one
SELECT count(*) FROM (SELECT 1 FROM credit_ledger_entries_default LIMIT 10001) pending;

-- name: LedgerPartitioned :one
SELECT phase='partitioned' FROM billing_ledger_partition_state;

-- name: PartitionedTransactionEntries :many
SELECT (to_jsonb(e) || jsonb_build_object('credit_delta', e.credit_delta::text, 'balance_after', e.balance_after::text))::jsonb
FROM credit_ledger_entry_keys k
CROSS JOIN LATERAL (
    SELECT * FROM credit_ledger_entries e WHERE e.id=k.id AND e.occurred_at=k.occurred_at OFFSET 0
) e
WHERE k.transaction_id=$1
ORDER BY e.sequence;
