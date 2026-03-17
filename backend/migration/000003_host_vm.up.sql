-- hosts 宿主机表
CREATE TABLE IF NOT EXISTS hosts (
    id VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    hostname VARCHAR(255),
    arch VARCHAR(255),
    cores INTEGER DEFAULT 0,
    weight INTEGER DEFAULT 1,
    memory BIGINT DEFAULT 0,
    disk BIGINT DEFAULT 0,
    os VARCHAR(255),
    external_ip VARCHAR(255),
    internal_ip VARCHAR(255),
    version VARCHAR(255),
    machine_id VARCHAR(255),
    remark VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_soft_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_hosts_user_id ON hosts(user_id);
CREATE INDEX IF NOT EXISTS idx_hosts_created_at ON hosts(created_at);

-- virtualmachines 虚拟机表
CREATE TABLE IF NOT EXISTS virtualmachines (
    id VARCHAR(255) PRIMARY KEY,
    host_id VARCHAR(255) NOT NULL REFERENCES hosts(id),
    user_id UUID REFERENCES users(id),
    model_id UUID REFERENCES models(id),
    environment_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    hostname VARCHAR(255),
    arch VARCHAR(255),
    cores INTEGER DEFAULT 0,
    memory BIGINT DEFAULT 0,
    os VARCHAR(255),
    external_ip VARCHAR(255),
    internal_ip VARCHAR(255),
    ttl_kind VARCHAR(255),
    ttl BIGINT DEFAULT 0,
    version VARCHAR(255),
    machine_id VARCHAR(255),
    repo_url VARCHAR(255),
    repo_filename VARCHAR(255),
    branch VARCHAR(255),
    is_recycled BOOLEAN DEFAULT FALSE,
    conditions JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_soft_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_virtualmachines_host_id ON virtualmachines(host_id);
CREATE INDEX IF NOT EXISTS idx_virtualmachines_user_id ON virtualmachines(user_id);
CREATE INDEX IF NOT EXISTS idx_virtualmachines_created_at ON virtualmachines(created_at);

-- team_hosts 团队-宿主机关联表
CREATE TABLE IF NOT EXISTS team_hosts (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES teams(id),
    host_id VARCHAR(255) NOT NULL REFERENCES hosts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, host_id)
);

CREATE INDEX IF NOT EXISTS idx_team_hosts_team_id ON team_hosts(team_id);

-- team_group_hosts 团队组-宿主机关联表
CREATE TABLE IF NOT EXISTS team_group_hosts (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES team_groups(id),
    host_id VARCHAR(255) NOT NULL REFERENCES hosts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, host_id)
);

CREATE INDEX IF NOT EXISTS idx_team_group_hosts_group_id ON team_group_hosts(group_id);
