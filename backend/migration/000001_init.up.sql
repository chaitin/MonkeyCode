-- 创建扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    avatar_url text,
    password character varying(128),
    role character varying(12),
    status character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    is_blocked boolean DEFAULT false,
    default_configs jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_users_role ON users USING btree (role) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_users_status ON users USING btree (status) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_users_email_role ON users USING btree (lower((email)::text), role) WHERE ((deleted_at IS NULL) AND (email IS NOT NULL) AND ((email)::text <> ''::text));


CREATE TABLE IF NOT EXISTS user_identities (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    platform character varying(12) NOT NULL,
    identity_id character varying(64) NOT NULL,
    username character varying(255) NOT NULL,
    email character varying(255),
    avatar_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);


CREATE INDEX IF NOT EXISTS idx_user_identities_identity_id ON user_identities USING btree (identity_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_platform ON user_identities USING btree (platform);
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_user_identities_platform_identity_id ON user_identities USING btree (platform, identity_id) WHERE (deleted_at IS NULL);


CREATE TABLE IF NOT EXISTS teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    member_limit integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_teams_created_at_id ON teams USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams USING btree (name);


CREATE TABLE IF NOT EXISTS team_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members USING btree (user_id);


CREATE TABLE IF NOT EXISTS team_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_team_groups_name ON team_groups USING btree (name);
CREATE INDEX IF NOT EXISTS idx_team_groups_team ON team_groups USING btree (team_id);


CREATE TABLE IF NOT EXISTS team_group_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_group_members ON team_group_members USING btree (user_id, group_id) WHERE (deleted_at IS NULL);


CREATE TABLE IF NOT EXISTS public.team_oauth_sites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    platform character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    base_url text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    proxy_url text DEFAULT ''::text NOT NULL,
    site_type character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_team_oauth_sites_team_id ON public.team_oauth_sites USING btree (team_id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_oauth_sites_team_platform_base_url ON public.team_oauth_sites USING btree (team_id, platform, base_url) WHERE (deleted_at IS NULL);


CREATE TABLE IF NOT EXISTS audits (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    operation character varying(255) NOT NULL,
    request text NOT NULL,
    source_ip text NOT NULL,
    user_agent text NOT NULL,
    response text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audits_user_id ON audits(user_id);
CREATE INDEX IF NOT EXISTS idx_audits_created_at ON audits(created_at);