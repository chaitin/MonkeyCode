DELETE FROM browser_sessions WHERE authentication_method = 'email_code';
ALTER TABLE browser_sessions DROP CONSTRAINT browser_sessions_authentication_method_check;
ALTER TABLE browser_sessions ADD CONSTRAINT browser_sessions_authentication_method_check CHECK (authentication_method IN ('password', 'oauth'));
DROP TABLE email_code_deliveries;
DROP TABLE email_codes;
