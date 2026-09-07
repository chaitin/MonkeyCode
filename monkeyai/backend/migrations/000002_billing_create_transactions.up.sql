BEGIN;
ALTER TABLE settings ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN billing_group_id uuid REFERENCES groups(id);
ALTER TABLE credit_accounts DROP CONSTRAINT credit_accounts_user_id_key;
ALTER TABLE credit_accounts ADD COLUMN frozen numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE credit_accounts ADD COLUMN quota numeric(24,6) NOT NULL DEFAULT 0;
ALTER TABLE credit_accounts ADD COLUMN group_id uuid REFERENCES groups(id);
ALTER TABLE credit_accounts ADD COLUMN sequence bigint NOT NULL DEFAULT 0;
UPDATE credit_accounts a SET quota=GREATEST(balance,0),sequence=(SELECT count(*) FROM credit_ledger_entries e WHERE e.account_id=a.id);
ALTER TABLE credit_accounts ADD CONSTRAINT credit_accounts_amount_check CHECK(balance >= 0 AND frozen >= 0 AND frozen <= balance) NOT VALID;
CREATE UNIQUE INDEX credit_accounts_user_period_key ON credit_accounts(user_id,period_start_at);
ALTER TABLE model_calls ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE mcp_tool_calls ALTER COLUMN session_id DROP NOT NULL;
CREATE TABLE billing_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 account_id uuid NOT NULL REFERENCES credit_accounts(id),
 session_id uuid REFERENCES sessions(id),
 category text NOT NULL CHECK(category IN ('model','tool')),
 resource_id uuid NOT NULL,
 connector_id uuid REFERENCES connectors(id),
 item_name text NOT NULL,
 user_name text NOT NULL,
 user_email text NOT NULL,
 group_id uuid REFERENCES groups(id),
 mode text NOT NULL CHECK(mode IN ('local','remote')),
 status text NOT NULL CHECK(status IN ('created','reserved','running','settling','settled','released','rejected','unknown')),
 reserve numeric(24,6) NOT NULL CHECK(reserve >= 0),
 amount numeric(24,6),
 raw_amount numeric(24,6),
 pricing jsonb NOT NULL CHECK(jsonb_typeof(pricing)='object'),
 usage jsonb NOT NULL DEFAULT '{}',
 result text,
 error_code text NOT NULL DEFAULT '',
 idempotency_key text,
 request_hash text NOT NULL DEFAULT '',
 request_id text NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 next_retry_at timestamptz,
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(amount IS NULL OR amount >= 0)
);
CREATE UNIQUE INDEX billing_transactions_idempotency_key ON billing_transactions(user_id,category,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX billing_transactions_status_idx ON billing_transactions(status,next_retry_at);
CREATE INDEX billing_transactions_user_time_idx ON billing_transactions(user_id,started_at DESC,id DESC);
ALTER TABLE credit_ledger_entries ADD COLUMN transaction_id uuid REFERENCES billing_transactions(id);
ALTER TABLE credit_ledger_entries ADD COLUMN event_key text;
ALTER TABLE credit_ledger_entries ADD COLUMN sequence bigint;
ALTER TABLE credit_ledger_entries ADD COLUMN user_name text;
ALTER TABLE credit_ledger_entries ADD COLUMN user_email text;
ALTER TABLE credit_ledger_entries ADD COLUMN group_id uuid REFERENCES groups(id);
ALTER TABLE credit_ledger_entries ADD COLUMN mode text NOT NULL DEFAULT 'local';
ALTER TABLE credit_ledger_entries ADD COLUMN reverses_id uuid REFERENCES credit_ledger_entries(id);
WITH numbered AS (SELECT id,row_number() OVER(PARTITION BY account_id ORDER BY created_at,id) AS n FROM credit_ledger_entries) UPDATE credit_ledger_entries e SET sequence=n.n FROM numbered n WHERE n.id=e.id;
UPDATE credit_ledger_entries e SET user_name=u.name,user_email=u.email FROM users u WHERE u.id=e.user_id;
CREATE UNIQUE INDEX credit_ledger_entries_event_key ON credit_ledger_entries(event_key) WHERE event_key IS NOT NULL;
CREATE UNIQUE INDEX credit_ledger_entries_sequence_key ON credit_ledger_entries(account_id,sequence);
CREATE INDEX credit_ledger_entries_time_idx ON credit_ledger_entries(occurred_at DESC,id DESC);
CREATE TABLE wallet_user_bindings (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 external_user_id text NOT NULL UNIQUE,
 verified_at timestamptz NOT NULL,
 updated_by_user_id uuid NOT NULL REFERENCES users(id)
);
CREATE TABLE wallet_billing_records (
 biz_id text PRIMARY KEY,
 transaction_id uuid NOT NULL UNIQUE REFERENCES billing_transactions(id),
 external_user_id text NOT NULL,
 team_slug text NOT NULL DEFAULT '',
 environment text NOT NULL,
 app_id integer NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','reserved','confirming','confirmed','rejected','unknown')),
 frozen_amount_quota bigint NOT NULL CHECK(frozen_amount_quota >= 0),
 actual_amount_quota bigint,
 confirmation_status text,
 error_code text NOT NULL DEFAULT '',
 trace_id text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz
);
CREATE TABLE billing_migration_issues (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 subject text NOT NULL,
 value jsonb NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id)
SELECT 'group','00000000-0000-0000-0000-000000000001',CASE WHEN (s.value->>'root_credits') ~ '^\d+(\.\d{1,6})?$' THEN (s.value->>'root_credits')::numeric ELSE 15000 END,s.updated_by_user_id
FROM settings s WHERE s.key='billing' AND EXISTS(SELECT 1 FROM groups WHERE id='00000000-0000-0000-0000-000000000001') AND NOT EXISTS(SELECT 1 FROM billing_quotas WHERE group_id='00000000-0000-0000-0000-000000000001' AND deleted_at IS NULL);
CREATE TEMP TABLE billing_legacy_quotas ON COMMIT DROP AS
SELECT e.key,e.value,s.updated_by_user_id,
 CASE WHEN g.id IS NOT NULL AND u.id IS NULL THEN 'group' WHEN u.id IS NOT NULL AND g.id IS NULL THEN 'user' END subject_type,
 g.id group_id,u.id user_id,
 CASE WHEN (e.value #>> '{}') ~ '^\d{1,12}(\.\d{1,6})?$' THEN (e.value #>> '{}')::numeric END credits
FROM settings s
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s.value->'quota_overrides')='object' THEN s.value->'quota_overrides' ELSE '{}' END) e
LEFT JOIN groups g ON g.id::text=lower(e.key) AND g.deleted_at IS NULL
LEFT JOIN users u ON u.id::text=lower(e.key) AND u.deleted_at IS NULL
WHERE s.key='billing';
INSERT INTO billing_migration_issues(subject,value,reason)
SELECT l.key,l.value,CASE WHEN l.subject_type IS NULL THEN '旧额度对象不能匹配唯一真实用户或分组' WHEN l.credits IS NULL THEN '旧额度金额无效' ELSE '额度表已存在配置，保留原配置并记录差异' END
FROM billing_legacy_quotas l WHERE l.subject_type IS NULL OR l.credits IS NULL OR EXISTS(SELECT 1 FROM billing_quotas q WHERE q.deleted_at IS NULL AND (q.group_id=l.group_id OR q.user_id=l.user_id) AND q.credits_per_cycle<>l.credits);
INSERT INTO billing_quotas(subject_type,group_id,user_id,credits_per_cycle,updated_by_user_id)
SELECT l.subject_type,l.group_id,l.user_id,l.credits,l.updated_by_user_id FROM billing_legacy_quotas l
WHERE l.subject_type IS NOT NULL AND l.credits IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_quotas q WHERE q.deleted_at IS NULL AND (q.group_id=l.group_id OR q.user_id=l.user_id));

UPDATE settings SET value=value-'quota_overrides'-'remote_billing_api_key'-'remote_billing_base_url',revision=revision+1 WHERE key='billing';
CREATE FUNCTION billing_immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '计费流水不可修改或删除，请使用冲正'; END $$;
CREATE TRIGGER credit_ledger_immutable BEFORE UPDATE OR DELETE ON credit_ledger_entries FOR EACH ROW EXECUTE FUNCTION billing_immutable_ledger();
COMMIT;
