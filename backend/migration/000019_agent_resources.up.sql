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
-- agent_rule_versions
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_rule_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       UUID NOT NULL REFERENCES agent_rules(id),
  version       VARCHAR(14) NOT NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_rule_versions_rule
  ON agent_rule_versions (rule_id);

-- =====================================================================
-- agent_skill_repos: 三级 scope + bare 类型一步到位
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_skill_repos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  scope_type            VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'team', 'user')),
  scope_id              VARCHAR(64) NOT NULL DEFAULT 'global',
  created_by            UUID NOT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  source_type           VARCHAR(16) NOT NULL
    CHECK (source_type IN ('github', 'upload', 'bare')),
  github_url            VARCHAR(512),
  ref_type              VARCHAR(16)
    CHECK (ref_type IS NULL OR ref_type IN ('branch', 'tag', 'commit')),
  ref_value             VARCHAR(255),
  last_upload_filename  VARCHAR(512),
  last_upload_at        TIMESTAMP,
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
    OR
    (source_type = 'bare'
       AND github_url IS NULL
       AND ref_type IS NULL
       AND ref_value IS NULL
       AND last_upload_filename IS NULL
       AND last_upload_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_skill_repos_scope
  ON agent_skill_repos (scope_type, scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_skill_repos_bare_scope
  ON agent_skill_repos (scope_type, scope_id)
  WHERE source_type = 'bare' AND is_deleted = FALSE;

-- =====================================================================
-- agent_plugin_repos: 同上 + npm
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_plugin_repos (
  id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                                VARCHAR(255) NOT NULL,
  scope_type                          VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'team', 'user')),
  scope_id                            VARCHAR(64) NOT NULL DEFAULT 'global',
  created_by                          UUID NOT NULL,
  created_at                          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMP NOT NULL DEFAULT NOW(),
  is_deleted                          BOOLEAN NOT NULL DEFAULT FALSE,
  source_type                         VARCHAR(16) NOT NULL
    CHECK (source_type IN ('github', 'upload', 'npm', 'bare')),
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
  CONSTRAINT agent_plugin_repos_source_fields_chk CHECK (
    (source_type = 'github'
       AND github_url IS NOT NULL AND ref_type IS NOT NULL AND ref_value IS NOT NULL
       AND last_upload_filename IS NULL AND last_upload_at IS NULL
       AND npm_package_name IS NULL AND npm_version_spec IS NULL AND npm_registry_url IS NULL)
    OR
    (source_type = 'upload'
       AND github_url IS NULL AND ref_type IS NULL AND ref_value IS NULL
       AND npm_package_name IS NULL AND npm_version_spec IS NULL AND npm_registry_url IS NULL)
    OR
    (source_type = 'npm'
       AND npm_package_name IS NOT NULL
       AND github_url IS NULL AND ref_type IS NULL AND ref_value IS NULL
       AND last_upload_filename IS NULL AND last_upload_at IS NULL)
    OR
    (source_type = 'bare'
       AND github_url IS NULL AND ref_type IS NULL AND ref_value IS NULL
       AND last_upload_filename IS NULL AND last_upload_at IS NULL
       AND npm_package_name IS NULL AND npm_version_spec IS NULL AND npm_registry_url IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_plugin_repos_scope
  ON agent_plugin_repos (scope_type, scope_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_plugin_repos_bare_scope
  ON agent_plugin_repos (scope_type, scope_id)
  WHERE source_type = 'bare' AND is_deleted = FALSE;

-- =====================================================================
-- agent_skills: 字段一步到位(enabled + admin overrides + extension)
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_skills (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  description           TEXT,
  scope_type            VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'team', 'user')),
  scope_id              VARCHAR(64) NOT NULL DEFAULT 'global',
  repo_id               UUID NOT NULL REFERENCES agent_skill_repos(id),
  created_by            UUID NOT NULL,
  is_force_delivery     BOOLEAN NOT NULL DEFAULT FALSE,
  is_orphan             BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  admin_description     TEXT,
  admin_tags            JSONB,
  extension_package_id  VARCHAR(255),
  active_version_id     UUID,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
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
-- agent_plugins: 同 agent_skills 结构(无 admin overrides / extension)
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_plugins (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  scope_type         VARCHAR(32) NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'team', 'user')),
  scope_id           VARCHAR(64) NOT NULL DEFAULT 'global',
  repo_id            UUID NOT NULL REFERENCES agent_plugin_repos(id),
  created_by         UUID NOT NULL,
  is_force_delivery  BOOLEAN NOT NULL DEFAULT FALSE,
  is_orphan          BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
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
-- agent_sync_jobs
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
-- agent_skill_group_bindings: skill ↔ team_group M:N
-- =====================================================================
CREATE TABLE IF NOT EXISTS agent_skill_group_bindings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id   UUID NOT NULL REFERENCES agent_skills(id),
  group_id   UUID NOT NULL REFERENCES team_groups(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_skill_group_bindings
  ON agent_skill_group_bindings (skill_id, group_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_group_bindings_group
  ON agent_skill_group_bindings (group_id);

-- =====================================================================
-- active_version_id 反向 FK
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

-- =====================================================================
-- Backfill: 每个 team provision bare skill_repo + bare plugin_repo
-- =====================================================================
INSERT INTO agent_skill_repos (id, name, scope_type, scope_id, created_by, source_type, is_deleted, created_at, updated_at)
SELECT gen_random_uuid(),
       'team-' || t.id::text,
       'team',
       t.id::text,
       COALESCE(
         (SELECT tm.user_id FROM team_members tm
          WHERE tm.team_id = t.id AND tm.role = 'admin'
          ORDER BY tm.created_at ASC LIMIT 1),
         '00000000-0000-0000-0000-000000000000'::uuid
       ),
       'bare', FALSE, NOW(), NOW()
FROM teams t
WHERE NOT EXISTS (
  SELECT 1 FROM agent_skill_repos r
  WHERE r.scope_type = 'team' AND r.scope_id = t.id::text
    AND r.source_type = 'bare' AND r.is_deleted = FALSE
);

INSERT INTO agent_plugin_repos (id, name, scope_type, scope_id, created_by, source_type, is_deleted, plugin_discovery_auto_package_json, created_at, updated_at)
SELECT gen_random_uuid(),
       'team-' || t.id::text,
       'team',
       t.id::text,
       COALESCE(
         (SELECT tm.user_id FROM team_members tm
          WHERE tm.team_id = t.id AND tm.role = 'admin'
          ORDER BY tm.created_at ASC LIMIT 1),
         '00000000-0000-0000-0000-000000000000'::uuid
       ),
       'bare', FALSE, TRUE, NOW(), NOW()
FROM teams t
WHERE NOT EXISTS (
  SELECT 1 FROM agent_plugin_repos r
  WHERE r.scope_type = 'team' AND r.scope_id = t.id::text
    AND r.source_type = 'bare' AND r.is_deleted = FALSE
);

-- =====================================================================
-- 废弃旧团队 skill 模型 (000016_team_skills 创建的表)
-- =====================================================================
DROP TABLE IF EXISTS team_group_skills;
DROP TABLE IF EXISTS team_skills;
DROP TABLE IF EXISTS skills;

COMMIT;
