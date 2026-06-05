BEGIN;

-- =====================================================================
-- agent_rules: 全局规则资源（Markdown 全量内容由 DB 权威）
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  scope_type        VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type = 'global'),
  scope_id          VARCHAR(64) NOT NULL DEFAULT 'global'
    CHECK (scope_id = 'global'),
  active_version_id UUID,
  created_by        UUID NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_agent_rules_scope
  ON agent_rules (scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_agent_rules_active_version
  ON agent_rules (active_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_rules_name_scope
  ON agent_rules (name, scope_type, scope_id)
  WHERE is_deleted = FALSE;

-- =====================================================================
-- agent_rule_versions: rule 历史版本（content 是唯一权威源；rule 不上 S3）
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_rule_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       UUID NOT NULL REFERENCES agent_rules(id),
  version       VARCHAR(14) NOT NULL,           -- yyyymmddhhmmss
  content       TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_rule_versions_rule
  ON agent_rule_versions (rule_id);

-- =====================================================================
-- agent_skill_repos: skill 源仓库（github / upload）
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_skill_repos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  scope_type            VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type = 'global'),
  scope_id              VARCHAR(64) NOT NULL DEFAULT 'global'
    CHECK (scope_id = 'global'),
  created_by            UUID NOT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  source_type           VARCHAR(16) NOT NULL
    CHECK (source_type IN ('github', 'upload')),
  github_url            VARCHAR(512),
  ref_type              VARCHAR(16)
    CHECK (ref_type IS NULL OR ref_type IN ('branch', 'tag', 'commit')),
  ref_value             VARCHAR(255),
  last_upload_filename  VARCHAR(512),
  last_upload_at        TIMESTAMP,
  -- source_type 与字段对应（§3.3）
  CONSTRAINT agent_skill_repos_source_fields_chk CHECK (
    (source_type = 'github'
       AND github_url IS NOT NULL
       AND ref_type IS NOT NULL
       AND ref_value IS NOT NULL
       AND last_upload_filename IS NULL
       AND last_upload_at IS NULL)
    OR
    (source_type = 'upload'
       AND github_url IS NULL
       AND ref_type IS NULL
       AND ref_value IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_skill_repos_scope
  ON agent_skill_repos (scope_type, scope_id);

-- =====================================================================
-- agent_plugin_repos: plugin 源仓库（github / upload / npm）
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_plugin_repos (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                                VARCHAR(255) NOT NULL,
  scope_type                          VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type = 'global'),
  scope_id                            VARCHAR(64) NOT NULL DEFAULT 'global'
    CHECK (scope_id = 'global'),
  created_by                          UUID NOT NULL,
  created_at                          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMP NOT NULL DEFAULT NOW(),
  is_deleted                          BOOLEAN NOT NULL DEFAULT FALSE,
  source_type                         VARCHAR(16) NOT NULL
    CHECK (source_type IN ('github', 'upload', 'npm')),
  github_url                          VARCHAR(512),
  ref_type                            VARCHAR(16)
    CHECK (ref_type IS NULL OR ref_type IN ('branch', 'tag', 'commit')),
  ref_value                           VARCHAR(255),
  last_upload_filename                VARCHAR(512),
  last_upload_at                      TIMESTAMP,
  plugin_discovery_auto_package_json  BOOLEAN NOT NULL DEFAULT TRUE,
  plugin_manual_entries               JSONB,
  npm_package_name                    VARCHAR(255),
  npm_version_spec                    VARCHAR(64),
  npm_registry_url                    VARCHAR(512),
  -- source_type 与字段对应（§3.3）
  CONSTRAINT agent_plugin_repos_source_fields_chk CHECK (
    (source_type = 'github'
       AND github_url IS NOT NULL
       AND ref_type IS NOT NULL
       AND ref_value IS NOT NULL
       AND last_upload_filename IS NULL
       AND last_upload_at IS NULL
       AND npm_package_name IS NULL
       AND npm_version_spec IS NULL
       AND npm_registry_url IS NULL)
    OR
    (source_type = 'upload'
       AND github_url IS NULL
       AND ref_type IS NULL
       AND ref_value IS NULL
       AND npm_package_name IS NULL
       AND npm_version_spec IS NULL
       AND npm_registry_url IS NULL)
    OR
    (source_type = 'npm'
       AND npm_package_name IS NOT NULL
       AND github_url IS NULL
       AND ref_type IS NULL
       AND ref_value IS NULL
       AND last_upload_filename IS NULL
       AND last_upload_at IS NULL
       AND plugin_discovery_auto_package_json = TRUE
       AND plugin_manual_entries IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_plugin_repos_scope
  ON agent_plugin_repos (scope_type, scope_id);

-- =====================================================================
-- agent_skills: skill 资源（指向 skill_repo）
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_skills (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  scope_type         VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type = 'global'),
  scope_id           VARCHAR(64) NOT NULL DEFAULT 'global'
    CHECK (scope_id = 'global'),
  repo_id            UUID NOT NULL REFERENCES agent_skill_repos(id),
  created_by         UUID NOT NULL,
  is_force_delivery  BOOLEAN NOT NULL DEFAULT FALSE,
  is_orphan          BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  active_version_id  UUID,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_scope
  ON agent_skills (scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_repo
  ON agent_skills (repo_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_active_version
  ON agent_skills (active_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_skills_repo_name
  ON agent_skills (repo_id, name);

-- =====================================================================
-- agent_plugins: plugin 资源（指向 plugin_repo）
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_plugins (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  scope_type         VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type = 'global'),
  scope_id           VARCHAR(64) NOT NULL DEFAULT 'global'
    CHECK (scope_id = 'global'),
  repo_id            UUID NOT NULL REFERENCES agent_plugin_repos(id),
  created_by         UUID NOT NULL,
  is_force_delivery  BOOLEAN NOT NULL DEFAULT FALSE,
  is_orphan          BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  active_version_id  UUID,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_plugins_scope
  ON agent_plugins (scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_agent_plugins_repo
  ON agent_plugins (repo_id);
CREATE INDEX IF NOT EXISTS idx_agent_plugins_active_version
  ON agent_plugins (active_version_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_plugins_repo_name
  ON agent_plugins (repo_id, name);

-- =====================================================================
-- agent_skill_versions / agent_plugin_versions
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_skill_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id  UUID NOT NULL REFERENCES agent_skills(id),
  version      VARCHAR(64) NOT NULL,
  s3_key       VARCHAR(512) NOT NULL,
  parsed_meta  JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_skill_versions_resource
  ON agent_skill_versions (resource_id);

CREATE TABLE IF NOT EXISTS agent_plugin_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id  UUID NOT NULL REFERENCES agent_plugins(id),
  version      VARCHAR(64) NOT NULL,
  s3_key       VARCHAR(512) NOT NULL,
  parsed_meta  JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_plugin_versions_resource
  ON agent_plugin_versions (resource_id);

-- =====================================================================
-- agent_sync_jobs: 同步任务流水（rule / skill / plugin 共用）
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_sync_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_kind   VARCHAR(16) NOT NULL
    CHECK (resource_kind IN ('rule', 'skill', 'plugin')),
  rule_id         UUID,
  repo_id         UUID,
  source_type     VARCHAR(16) NOT NULL
    CHECK (source_type IN ('github', 'upload', 'npm', 'rule_inline')),
  status          VARCHAR(16) NOT NULL
    CHECK (status IN ('pending', 'fetching', 'parsing', 'uploading', 'done', 'failed')),
  trigger_type    VARCHAR(16) NOT NULL
    CHECK (trigger_type IN ('manual', 'upload', 'rule_save')),
  triggered_by    UUID,
  started_at      TIMESTAMP,
  finished_at     TIMESTAMP,
  errors          JSONB,
  result_summary  JSONB,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  -- resource_kind 与 rule_id / repo_id 的对应
  CONSTRAINT agent_sync_jobs_resource_ref_chk CHECK (
    (resource_kind = 'rule'
       AND rule_id IS NOT NULL
       AND repo_id IS NULL)
    OR
    (resource_kind IN ('skill', 'plugin')
       AND repo_id IS NOT NULL
       AND rule_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_sync_jobs_status_created
  ON agent_sync_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_sync_jobs_resource_kind
  ON agent_sync_jobs (resource_kind);

-- =====================================================================
-- active_version_id 反向 FK（版本表已建好后追加）
-- =====================================================================
ALTER TABLE agent_rules
  ADD CONSTRAINT agent_rules_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES agent_rule_versions(id);

ALTER TABLE agent_skills
  ADD CONSTRAINT agent_skills_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES agent_skill_versions(id);

ALTER TABLE agent_plugins
  ADD CONSTRAINT agent_plugins_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES agent_plugin_versions(id);

COMMIT;
