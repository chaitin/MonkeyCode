BEGIN;

DROP TABLE oauth_tokens;
DROP TABLE oauth_authorization_codes;
DROP TABLE oauth_login_states;
DROP TABLE oauth_authorization_requests;
DROP TABLE browser_sessions;

COMMIT;
