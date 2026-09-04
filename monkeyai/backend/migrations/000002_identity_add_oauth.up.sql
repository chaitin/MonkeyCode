BEGIN;

CREATE TABLE browser_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES users (id),
    authentication_method text NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT browser_sessions_authentication_method_check CHECK (
        authentication_method IN ('password', 'oauth')
    ),
    CONSTRAINT browser_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX browser_sessions_user_idx
    ON browser_sessions (user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE oauth_authorization_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    state text NOT NULL,
    code_challenge text NOT NULL,
    code_challenge_method text NOT NULL,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_authorization_requests_method_check CHECK (
        code_challenge_method = 'S256'
    ),
    CONSTRAINT oauth_authorization_requests_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE oauth_login_states (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    state_hash text NOT NULL UNIQUE,
    connection_id text NOT NULL,
    authorization_request_id uuid NOT NULL REFERENCES oauth_authorization_requests (id),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_login_states_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE oauth_authorization_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash text NOT NULL UNIQUE,
    authorization_request_id uuid NOT NULL UNIQUE REFERENCES oauth_authorization_requests (id),
    user_id uuid NOT NULL REFERENCES users (id),
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    expires_at timestamptz NOT NULL,
    redeemed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_authorization_codes_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE oauth_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    client_id text NOT NULL,
    access_token_hash text NOT NULL UNIQUE,
    refresh_token_hash text NOT NULL UNIQUE,
    access_expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT oauth_tokens_expiry_check CHECK (
        access_expires_at > created_at AND refresh_expires_at > access_expires_at
    )
);

CREATE INDEX oauth_tokens_user_idx
    ON oauth_tokens (user_id, client_id)
    WHERE revoked_at IS NULL;

COMMIT;
