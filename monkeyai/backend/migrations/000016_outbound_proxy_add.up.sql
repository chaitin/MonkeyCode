ALTER TABLE settings DROP CONSTRAINT settings_key_check,
    ADD CONSTRAINT settings_key_check CHECK (key IN ('branding', 'authentication', 'email', 'billing', 'session_reporting', 'proxies'));

ALTER TABLE models ADD COLUMN proxy_id text NOT NULL DEFAULT '';
ALTER TABLE connectors ADD COLUMN proxy_id text NOT NULL DEFAULT '';
