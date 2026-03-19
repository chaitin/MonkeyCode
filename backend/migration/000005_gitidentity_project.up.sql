-- git_identities: Git 平台身份凭证
CREATE TABLE IF NOT EXISTS git_identities (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    platform character varying(12) NOT NULL,
    base_url text,
    access_token text,
    username text,
    email text,
    remark text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    installation_id bigint,
    oauth_refresh_token text DEFAULT ''::text,
    oauth_expires_at timestamp with time zone,
    oauth_site_id uuid
);

CREATE INDEX IF NOT EXISTS idx_git_identities_installation_id ON git_identities USING btree (installation_id);
CREATE INDEX IF NOT EXISTS idx_git_identities_oauth_site_id ON git_identities USING btree (oauth_site_id);
CREATE INDEX IF NOT EXISTS idx_git_identities_user_id ON git_identities USING btree (user_id);
ALTER TABLE ONLY git_identities
    ADD CONSTRAINT fk_git_identities_oauth_site_id FOREIGN KEY (oauth_site_id) REFERENCES team_oauth_sites(id) ON DELETE SET NULL;


-- projects: 项目
CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    repo_url text,
    platform character varying(255),
    git_identity_id uuid,
    branch character varying(255),
    image_id uuid,
    env_variables jsonb
);

CREATE INDEX IF NOT EXISTS idx_projects_created_at_id ON projects USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_projects_git_identity_id ON projects USING btree (git_identity_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects USING btree (user_id);


-- project_collaborators: 项目协作者
CREATE TABLE IF NOT EXISTS project_collaborators (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(50) DEFAULT 'read_only'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_project_collaborators_project_user ON project_collaborators USING btree (project_id, user_id) WHERE (deleted_at IS NULL);


-- project_issues: 项目 Issue
CREATE TABLE IF NOT EXISTS project_issues (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status character varying(50) DEFAULT 'todo'::character varying NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    requirement_document text,
    assignee_id uuid,
    priority integer DEFAULT 2 NOT NULL,
    design_document text,
    summary text
);

CREATE INDEX IF NOT EXISTS idx_project_issues_created_at_id ON project_issues USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_project_issues_project_id ON project_issues USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_project_issues_status ON project_issues USING btree (status);
CREATE INDEX IF NOT EXISTS idx_project_issues_user_id ON project_issues USING btree (user_id);


-- project_issue_comments: Issue 评论
CREATE TABLE IF NOT EXISTS project_issue_comments (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    issue_id uuid NOT NULL,
    parent_id uuid,
    comment text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_project_issue_comments_created_at_id ON project_issue_comments USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_project_issue_comments_issue_id ON project_issue_comments USING btree (issue_id);
CREATE INDEX IF NOT EXISTS idx_project_issue_comments_parent_id ON project_issue_comments USING btree (parent_id);
CREATE INDEX IF NOT EXISTS idx_project_issue_comments_user_id ON project_issue_comments USING btree (user_id);