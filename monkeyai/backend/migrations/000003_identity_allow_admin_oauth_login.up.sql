BEGIN;

ALTER TABLE oauth_login_states
    ALTER COLUMN authorization_request_id DROP NOT NULL,
    ADD COLUMN purpose text NOT NULL DEFAULT 'client';

ALTER TABLE oauth_login_states
    ADD CONSTRAINT oauth_login_states_purpose_check CHECK (
        purpose IN ('client', 'admin')
    ),
    ADD CONSTRAINT oauth_login_states_target_check CHECK (
        (purpose = 'client' AND authorization_request_id IS NOT NULL)
        OR (purpose = 'admin' AND authorization_request_id IS NULL)
    );

COMMIT;
