ALTER TABLE mcp_upstreams
    DROP CONSTRAINT IF EXISTS mcp_upstreams_scope_check;

ALTER TABLE mcp_upstreams
    ADD CONSTRAINT mcp_upstreams_scope_check
    CHECK ((scope)::text = ANY ((ARRAY['platform'::character varying, 'user'::character varying, 'team'::character varying])::text[]));

ALTER TABLE mcp_upstreams
    ADD COLUMN IF NOT EXISTS team_id uuid;

CREATE INDEX IF NOT EXISTS idx_mcp_upstreams_team_id
    ON mcp_upstreams USING btree (team_id);

DROP INDEX IF EXISTS idx_mcp_upstreams_scope_user_slug;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_upstreams_scope_user_slug
    ON mcp_upstreams USING btree (scope, user_id, slug)
    WHERE deleted_at IS NULL AND team_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_upstreams_scope_team_slug
    ON mcp_upstreams USING btree (scope, team_id, slug)
    WHERE deleted_at IS NULL AND team_id IS NOT NULL;

ALTER TABLE mcp_tools
    DROP CONSTRAINT IF EXISTS mcp_tools_scope_check;

ALTER TABLE mcp_tools
    ADD CONSTRAINT mcp_tools_scope_check
    CHECK ((scope)::text = ANY ((ARRAY['platform'::character varying, 'user'::character varying, 'team'::character varying])::text[]));

ALTER TABLE mcp_tools
    ADD COLUMN IF NOT EXISTS team_id uuid;

CREATE INDEX IF NOT EXISTS idx_mcp_tools_team_id
    ON mcp_tools USING btree (team_id);

DROP INDEX IF EXISTS idx_mcp_tools_scope_user_namespaced_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_user_namespaced_name
    ON mcp_tools USING btree (scope, user_id, namespaced_name)
    WHERE team_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_team_namespaced_name
    ON mcp_tools USING btree (scope, team_id, namespaced_name)
    WHERE team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_group_mcp_upstreams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    group_id uuid NOT NULL,
    upstream_id uuid NOT NULL REFERENCES mcp_upstreams(id),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE (group_id, upstream_id)
);

CREATE INDEX IF NOT EXISTS idx_team_group_mcp_upstreams_team_id
    ON team_group_mcp_upstreams USING btree (team_id);

CREATE INDEX IF NOT EXISTS idx_team_group_mcp_upstreams_group_id
    ON team_group_mcp_upstreams USING btree (group_id);

CREATE TABLE IF NOT EXISTS mcp_tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    request_id character varying(128) NOT NULL UNIQUE,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    upstream_id uuid NOT NULL REFERENCES mcp_upstreams(id),
    tool_id uuid NOT NULL REFERENCES mcp_tools(id),
    tool_name_snapshot character varying(320) NOT NULL,
    tool_scope_snapshot character varying(16) DEFAULT 'platform'::character varying NOT NULL,
    price_snapshot bigint DEFAULT 0 NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    args_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    result_json jsonb,
    error_message text DEFAULT ''::text NOT NULL,
    upstream_request_id character varying(128),
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mcp_tool_calls_scope_check CHECK (((tool_scope_snapshot)::text = ANY ((ARRAY['platform'::character varying, 'user'::character varying, 'team'::character varying])::text[]))),
    CONSTRAINT mcp_tool_calls_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'success'::character varying, 'failed'::character varying, 'unknown'::character varying, 'refunded'::character varying])::text[])))
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_task_id ON mcp_tool_calls USING btree (task_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_user_id ON mcp_tool_calls USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_upstream_id ON mcp_tool_calls USING btree (upstream_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_tool_id ON mcp_tool_calls USING btree (tool_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_status ON mcp_tool_calls USING btree (status);
