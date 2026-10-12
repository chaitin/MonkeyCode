DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM settings WHERE key = 'proxies') THEN
        RAISE EXCEPTION 'proxies setting exists; cannot restore settings constraint';
    END IF;
END $$;
ALTER TABLE connectors DROP COLUMN proxy_id;
ALTER TABLE models DROP COLUMN proxy_id;
ALTER TABLE settings DROP CONSTRAINT settings_key_check,
    ADD CONSTRAINT settings_key_check CHECK (key IN ('branding', 'authentication', 'email', 'billing', 'session_reporting'));
