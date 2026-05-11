CREATE TABLE IF NOT EXISTS mcp_upstreams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    name character varying(128) NOT NULL,
    slug character varying(64) NOT NULL,
    scope character varying(16) DEFAULT 'platform'::character varying NOT NULL,
    user_id uuid,
    type character varying(16) DEFAULT 'server'::character varying NOT NULL,
    url text NOT NULL,
    headers jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    health_status character varying(16) DEFAULT 'unknown'::character varying NOT NULL,
    sync_status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    health_checked_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT mcp_upstreams_scope_check CHECK (((scope)::text = ANY ((ARRAY['platform'::character varying, 'user'::character varying])::text[]))),
    CONSTRAINT mcp_upstreams_type_check CHECK (((type)::text = 'server'::text)),
    CONSTRAINT mcp_upstreams_health_status_check CHECK (((health_status)::text = ANY ((ARRAY['healthy'::character varying, 'unhealthy'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT mcp_upstreams_sync_status_check CHECK (((sync_status)::text = ANY ((ARRAY['pending'::character varying, 'success'::character varying, 'failed'::character varying])::text[])))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_upstreams_scope_user_slug ON mcp_upstreams USING btree (scope, user_id, slug)
    WHERE (deleted_at IS NULL);

CREATE TABLE IF NOT EXISTS mcp_tools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    upstream_id uuid NOT NULL REFERENCES mcp_upstreams(id),
    name character varying(256) NOT NULL,
    namespaced_name character varying(320) NOT NULL,
    scope character varying(16) DEFAULT 'platform'::character varying NOT NULL,
    user_id uuid,
    description text DEFAULT ''::text NOT NULL,
    input_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    price bigint DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    version_hash character varying(64),
    synced_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mcp_tools_scope_check CHECK (((scope)::text = ANY ((ARRAY['platform'::character varying, 'user'::character varying])::text[])))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_user_namespaced_name ON mcp_tools USING btree (scope, user_id, namespaced_name);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_upstream_id ON mcp_tools USING btree (upstream_id);

CREATE TABLE IF NOT EXISTS mcp_user_tool_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tool_id uuid NOT NULL REFERENCES mcp_tools(id),
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    UNIQUE (user_id, tool_id)
);
