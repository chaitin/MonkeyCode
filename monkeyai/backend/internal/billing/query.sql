-- name: SavePolicy :execresult
UPDATE
    settings
SET
    value = $1,
    revision = $2,
    updated_by_user_id = $3,
    updated_at = now()
WHERE
    KEY = 'billing';

-- name: ListGroupQuotas :many
SELECT
    jsonb_build_object('id', g.id, 'parent_id', COALESCE(g.parent_id::text, 'team')::text,
	'name', g.name, 'credits', q.credits_per_cycle::text)
FROM
    GROUPS g
    LEFT JOIN billing_quotas q ON q.group_id = g.id
        AND q.deleted_at IS NULL
WHERE
    g.deleted_at IS NULL
ORDER BY
    g.name,
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
)
SELECT
    jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'status', u.status,
	'group_id', COALESCE(u.billing_group_id::text, sqlc.arg(root_group)::text)::text, 'credits',
	q.credits_per_cycle::text, 'effective_credits', COALESCE(q.credits_per_cycle, g.credits_per_cycle,
	sqlc.arg(root_credits)::numeric)::text, 'inherited_from', CASE WHEN q.id IS NOT NULL THEN
            u.id::text
        ELSE
            COALESCE(g.ancestor::text, sqlc.arg(root_group)::text)::text
        END, 'external_user_id', wb.external_user_id)
FROM
    users u
    LEFT JOIN billing_quotas q ON q.user_id = u.id
        AND q.deleted_at IS NULL
    LEFT JOIN LATERAL (
        SELECT
            b.credits_per_cycle,
            a.ancestor
        FROM
            ancestors a
            JOIN billing_quotas b ON b.group_id = a.ancestor
                AND b.deleted_at IS NULL
        WHERE
            a.child = u.billing_group_id
        ORDER BY
            a.depth
        LIMIT 1) g ON TRUE
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

-- name: AccountHistory :many
SELECT
    jsonb_build_object('id', id, 'period_start_at', period_start_at, 'period_end_at', period_end_at,
	'balance', balance::text, 'frozen', frozen::text, 'quota', QUOTA::text)
FROM
    credit_accounts
WHERE
    user_id = $1
ORDER BY
    period_start_at DESC
LIMIT 24;

-- name: WalletUser :one
SELECT
    external_user_id
FROM
    wallet_user_bindings
WHERE
    user_id = $1;

-- name: GetAdjustment :one
SELECT
    credit_delta::text,
    item_name
FROM
    credit_ledger_entries
WHERE
    event_key = $1;

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
    id = $1
FOR UPDATE;

-- name: EventExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            credit_ledger_entries
        WHERE
            event_key = $1);

-- name: EventID :one
SELECT
    id
FROM
    credit_ledger_entries
WHERE
    event_key = $1;

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
AND (sqlc.narg(from_time)::timestamptz IS NULL
    OR e.occurred_at >= sqlc.narg(from_time))
AND (sqlc.narg(until_time)::timestamptz IS NULL
    OR e.occurred_at < sqlc.narg(until_time))
AND (sqlc.arg(group_id)::text = ''
    OR e.group_id = NULLIF (sqlc.arg(group_id)::text::text, '')::uuid);

-- name: ListEntries :many
SELECT
    (to_jsonb (e) || jsonb_build_object('credit_delta', e.credit_delta::text, 'balance_after', e.balance_after::text,
	'unit_credits', e.unit_credits::text, 'sequence', e.sequence::text))::jsonb
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
AND (sqlc.narg(from_time)::timestamptz IS NULL
    OR e.occurred_at >= sqlc.narg(from_time))
AND (sqlc.narg(until_time)::timestamptz IS NULL
    OR e.occurred_at < sqlc.narg(until_time))
AND (sqlc.arg(group_id)::text = ''
    OR e.group_id = NULLIF (sqlc.arg(group_id)::text::text, '')::uuid)
ORDER BY
    e.occurred_at DESC,
    e.id DESC
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
AND (sqlc.narg(from_time)::timestamptz IS NULL
    OR e.occurred_at >= sqlc.narg(from_time))
AND (sqlc.narg(until_time)::timestamptz IS NULL
    OR e.occurred_at < sqlc.narg(until_time))
AND (sqlc.arg(group_id)::text = ''
    OR e.group_id = NULLIF (sqlc.arg(group_id)::text::text, '')::uuid);

-- name: GetTransaction :one
SELECT
    (to_jsonb (t) || jsonb_build_object('reserve', reserve::text, 'amount', amount::text, 'raw_amount',
	raw_amount::text))::jsonb
FROM
    billing_transactions t
WHERE
    id = $1;

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
	'environment', environment, 'app_id', app_id, 'frozen_amount_quota', frozen_amount_quota::text,
	'actual_amount_quota', actual_amount_quota::text, 'error_code', error_code, 'trace_id', trace_id,
	'confirmed_at', confirmed_at)
FROM
    wallet_billing_records
WHERE
    transaction_id = $1;

-- name: PendingTransactions :many
SELECT
    jsonb_build_object('id', id, 'user_id', user_id, 'user_name', user_name, 'user_email',
	user_email, 'item_name', item_name, 'category', category, 'mode', MODE, 'status',
	status, 'reserve', reserve::text, 'amount', amount::text, 'error_code', error_code,
	'attempts', attempts, 'started_at', started_at)
FROM
    billing_transactions
WHERE
    status NOT IN ('settled', 'released', 'rejected')
ORDER BY
    started_at,
    id
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
	'ledger_balance', COALESCE(l.balance, 0)::text, 'frozen', a.frozen::text, 'reserved',
	COALESCE(t.reserved, 0)::text)
FROM
    credit_accounts a
    LEFT JOIN LATERAL (
        SELECT
            sum(credit_delta) balance
        FROM
            credit_ledger_entries
        WHERE
            account_id = a.id) l ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            sum(reserve) reserved
        FROM
            billing_transactions
        WHERE
            account_id = a.id
            AND status NOT IN ('settled', 'released', 'rejected')) t ON TRUE
WHERE
    a.balance <> COALESCE(l.balance, 0)
    OR a.frozen <> COALESCE(t.reserved, 0)
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
    id = $1;

-- name: LockTransactionStatus :one
SELECT
    status,
    MODE
FROM
    billing_transactions
WHERE
    id = $1
FOR UPDATE;

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
    period_end_at
FROM
    credit_accounts
WHERE
    user_id = $1
    AND period_start_at = $2
FOR UPDATE;

-- name: EffectiveQuota :one
WITH RECURSIVE CHAIN AS (
    SELECT
        g.id,
        g.parent_id,
        0 depth
    FROM
        users u
        JOIN GROUPS g ON g.id = u.billing_group_id
    WHERE
        u.id = sqlc.arg(id)
        AND g.deleted_at IS NULL
    UNION ALL
    SELECT
        g.id,
        g.parent_id,
        c.depth + 1
    FROM
        GROUPS g
        JOIN CHAIN c ON g.id = c.parent_id
    WHERE
        g.deleted_at IS NULL
        AND c.depth < 100
),
choices AS (
    SELECT
        credits_per_cycle,
        -1 depth,
        user_id::text SOURCE
    FROM
        billing_quotas
    WHERE
        user_id = sqlc.arg(id)
        AND deleted_at IS NULL
    UNION ALL
    SELECT
        q.credits_per_cycle,
        c.depth,
        c.id::text
    FROM
        CHAIN c
        JOIN billing_quotas q ON q.group_id = c.id
            AND q.deleted_at IS NULL
        UNION ALL
        SELECT
            COALESCE((value ->> 'root_credits')::numeric, 15000),
            101,
            sqlc.arg(root_group)::text
        FROM
            settings
    WHERE
        KEY = 'billing'
)
SELECT
    COALESCE((
        SELECT
            credits_per_cycle::text
        FROM choices ORDER BY depth LIMIT 1), '15000')::text AS credits,
    COALESCE((
        SELECT
            id::text
        FROM CHAIN
    WHERE
        depth = 0), '')::text AS group_id,
    COALESCE((
        SELECT
            SOURCE
        FROM choices ORDER BY depth LIMIT 1), sqlc.arg(root_group)::text)::text AS source;

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
    LEFT JOIN billing_transactions t ON t.id = NULLIF (sqlc.arg(transaction_id)::text, '')::uuid;

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
SELECT
    id,
    request_hash
FROM
    billing_transactions
WHERE
    user_id = $1
    AND category = $2
    AND idempotency_key = $3;

-- name: HasExceededReservation :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            billing_transactions
        WHERE
            user_id = $1
            AND status = 'unknown'
            AND error_code = 'reservation_exceeded');

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

-- name: ToolPricing :one
SELECT
    t.name,
    t.credits_per_call::text,
    c.authorization_mode
FROM
    mcp_tools t
    JOIN connectors c ON c.id = t.connector_id
WHERE
    t.id = sqlc.arg(id)
    AND c.id = sqlc.arg(connector_id)
    AND t.enabled
    AND t.deleted_at IS NULL
    AND c.deleted_at IS NULL;

-- name: FreezeBalance :execresult
UPDATE
    credit_accounts
SET
    frozen = frozen + $2,
    updated_at = now()
WHERE
    id = $1;

-- name: CreateTransaction :execresult
INSERT INTO billing_transactions (id, user_id, account_id, session_id, category, resource_id, connector_id, item_name,
    user_name, user_email, group_id, MODE, status, reserve, pricing, idempotency_key, request_hash, started_at)
    VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(account_id), NULLIF
	(sqlc.arg(session_id)::text, '')::UUID,sqlc.arg(category),sqlc.arg(resource_id),NULLIF(sqlc.arg(connector_id)::text,'')::uuid, sqlc.arg(item_name), sqlc.arg(user_name),
	sqlc.arg(user_email), NULLIF (sqlc.arg(group_id)::text, '')::UUID,sqlc.arg(mode),sqlc.arg(status),sqlc.arg(reserve),sqlc.arg(pricing),NULLIF(sqlc.arg(idempotency_key)::text,''), sqlc.arg(request_hash),
	sqlc.arg(started_at));

-- name: CreateWalletRecord :execresult
INSERT INTO wallet_billing_records (biz_id, transaction_id, external_user_id, team_slug, environment, app_id, status,
    frozen_amount_quota)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7);

-- name: StartTransaction :execresult
UPDATE
    billing_transactions
SET
    status = 'running',
    updated_at = now()
WHERE
    id = $1
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
    id = $1
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
    id = $1;

-- name: UpsertModelCall :execresult
INSERT INTO model_calls (id, session_id, user_id, model_id, request_id, status, input_tokens, cached_input_tokens,
    output_tokens, cache_hit, error_code, started_at, completed_at)
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
    started_at,
    completed_at
FROM
    billing_transactions bt
WHERE
    bt.id = sqlc.arg(id)
ON CONFLICT (id)
    DO UPDATE SET
        status = EXCLUDED.status,
        input_tokens = EXCLUDED.input_tokens,
        cached_input_tokens = EXCLUDED.cached_input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cache_hit = EXCLUDED.cache_hit,
        error_code = EXCLUDED.error_code,
        completed_at = EXCLUDED.completed_at;

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
    started_at,
    completed_at
FROM
    billing_transactions bt
WHERE
    bt.id = $1
ON CONFLICT (id)
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

-- name: SettlementStatus :one
SELECT
    MODE,
    status
FROM
    billing_transactions
WHERE
    id = $1;

-- name: LockSettlement :one
SELECT
    account_id,
    item_name,
    category,
    amount::text,
    reserve::text,
    status
FROM
    billing_transactions
WHERE
    id = $1
FOR UPDATE;

-- name: ChargeBalance :execresult
UPDATE
    credit_accounts
SET
    balance = balance - $2,
    frozen = frozen - $3,
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
    id = $1;

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
    id = $1;

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
    environment,
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
    id = $1;

-- name: ReleaseFrozenBalance :execresult
UPDATE
    credit_accounts a
SET
    frozen = a.frozen - t.reserve
FROM
    billing_transactions t
WHERE
    t.id = $1
    AND a.id = t.account_id;

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
    id = $1
    AND status = 'created';

-- name: WalletConfirmation :one
SELECT
    w.biz_id,
    w.external_user_id,
    w.team_slug,
    w.environment,
    w.app_id,
    w.status,
    t.item_name,
    t.amount::text
FROM
    wallet_billing_records w
    JOIN billing_transactions t ON t.id = w.transaction_id
WHERE
    t.id = $1;

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
    id = $1;

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
SELECT
    *
FROM
    settings
WHERE
    KEY = 'billing';

-- name: LockPolicy :one
SELECT
    *
FROM
    settings
WHERE
    KEY = 'billing'
FOR UPDATE;
