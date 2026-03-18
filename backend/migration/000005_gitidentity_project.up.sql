-- git_identities: Git 平台身份凭证
CREATE TABLE IF NOT EXISTS git_identities (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    platform VARCHAR(50) NOT NULL,
    base_url VARCHAR(500),
    access_token TEXT,
    username VARCHAR(255),
    email VARCHAR(255),
    installation_id BIGINT,
    remark VARCHAR(500),
    oauth_refresh_token TEXT,
    oauth_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_git_identities_user_id ON git_identities(user_id);

-- projects: 项目
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    platform VARCHAR(50),
    repo_url VARCHAR(500),
    branch VARCHAR(255),
    git_identity_id UUID REFERENCES git_identities(id),
    image_id UUID REFERENCES images(id),
    env_variables JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_git_identity_id ON projects(git_identity_id);

-- project_collaborators: 项目协作者
CREATE TABLE IF NOT EXISTS project_collaborators (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(50) NOT NULL DEFAULT 'read_only',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_collaborators_unique ON project_collaborators(project_id, user_id) WHERE deleted_at IS NULL;

-- project_issues: 项目 Issue
CREATE TABLE IF NOT EXISTS project_issues (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    project_id UUID NOT NULL REFERENCES projects(id),
    status VARCHAR(50) NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    requirement_document TEXT,
    design_document TEXT,
    summary TEXT,
    assignee_id UUID REFERENCES users(id),
    priority INTEGER NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_project_issues_project_id ON project_issues(project_id);
CREATE INDEX IF NOT EXISTS idx_project_issues_user_id ON project_issues(user_id);

-- project_issue_comments: Issue 评论
CREATE TABLE IF NOT EXISTS project_issue_comments (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    issue_id UUID NOT NULL REFERENCES project_issues(id),
    parent_id UUID REFERENCES project_issue_comments(id),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_project_issue_comments_issue_id ON project_issue_comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_project_issue_comments_user_id ON project_issue_comments(user_id);
