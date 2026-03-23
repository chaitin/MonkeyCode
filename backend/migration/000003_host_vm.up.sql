-- hosts 宿主机表
CREATE TABLE IF NOT EXISTS hosts (
    id character varying(64) PRIMARY KEY NOT NULL,
    user_id uuid NOT NULL,
    hostname character varying(64),
    arch character varying(64),
    cores integer,
    memory bigint,
    disk bigint,
    os character varying(64),
    external_ip character varying(64),
    internal_ip character varying(64),
    version character varying(32),
    machine_id character varying(128),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    remark character varying(128),
    weight integer DEFAULT 1 NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hosts_created_at_id ON hosts USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts USING btree (user_id);

-- virtualmachines 虚拟机表
CREATE TABLE IF NOT EXISTS virtualmachines (
    id character varying(64) PRIMARY KEY NOT NULL,
    host_id character varying(64) NOT NULL,
    repo_id uuid,
    model_id uuid,
    environment_id character varying(64),
    name character varying(255) NOT NULL,
    hostname character varying(255),
    arch character varying(64),
    cores integer,
    memory bigint,
    os character varying(64),
    external_ip character varying(64),
    internal_ip character varying(64),
    ttl_kind character varying(12),
    ttl bigint,
    machine_id character varying(128),
    version character varying(32),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    git_identity_id uuid,
    branch text,
    user_id uuid,
    repo_url text DEFAULT ''::text NOT NULL,
    conditions jsonb,
    is_recycled boolean DEFAULT false,
    repo_filename text
);

CREATE INDEX IF NOT EXISTS idx_virtualmachines_created_at_id ON virtualmachines USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_virtualmachines_git_identity_id ON virtualmachines USING btree (git_identity_id);
CREATE INDEX IF NOT EXISTS idx_virtualmachines_host ON virtualmachines USING btree (host_id);
CREATE INDEX IF NOT EXISTS idx_virtualmachines_model ON virtualmachines USING btree (model_id);
CREATE INDEX IF NOT EXISTS idx_virtualmachines_repo ON virtualmachines USING btree (repo_id);


-- team_hosts 团队-宿主机关联表
CREATE TABLE IF NOT EXISTS team_hosts (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    team_id uuid NOT NULL,
    host_id character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_hosts_team_host ON team_hosts USING btree (team_id, host_id);


-- team_group_hosts 团队组-宿主机关联表
CREATE TABLE IF NOT EXISTS team_group_hosts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    host_id character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_group_hosts ON team_group_hosts USING btree (host_id, group_id) WHERE (deleted_at IS NULL);