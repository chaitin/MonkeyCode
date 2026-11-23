BEGIN;
DELETE FROM oauth_login_states WHERE purpose='web';
ALTER TABLE oauth_login_states
    DROP CONSTRAINT oauth_login_states_purpose_check,
    DROP CONSTRAINT oauth_login_states_request_check,
    ADD CONSTRAINT oauth_login_states_purpose_check CHECK (purpose IN ('client','admin','device')),
    ADD CONSTRAINT oauth_login_states_request_check CHECK (
        (purpose='client' AND authorization_request_id IS NOT NULL AND device_request_id IS NULL) OR
        (purpose='admin' AND authorization_request_id IS NULL AND device_request_id IS NULL) OR
        (purpose='device' AND authorization_request_id IS NULL AND device_request_id IS NOT NULL));
COMMIT;
