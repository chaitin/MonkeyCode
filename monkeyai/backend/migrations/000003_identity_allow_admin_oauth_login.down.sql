BEGIN;

DELETE FROM oauth_login_states WHERE purpose = 'admin';

ALTER TABLE oauth_login_states
    DROP CONSTRAINT oauth_login_states_target_check,
    DROP CONSTRAINT oauth_login_states_purpose_check,
    ALTER COLUMN authorization_request_id SET NOT NULL,
    DROP COLUMN purpose;

COMMIT;
