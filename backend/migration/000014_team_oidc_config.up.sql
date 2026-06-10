CREATE TABLE IF NOT EXISTS team_oidc_configs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    team_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    display_name text DEFAULT '企业登录' NOT NULL,
    issuer text NOT NULL,
    client_id text NOT NULL,
    client_secret_ciphertext text DEFAULT '',
    scopes text DEFAULT 'openid email profile' NOT NULL,
    email_domain text DEFAULT '',
    auto_create_member boolean DEFAULT false NOT NULL,
    allow_password_login boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT team_oidc_configs_team_id_key UNIQUE (team_id),
    CONSTRAINT team_oidc_configs_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);
