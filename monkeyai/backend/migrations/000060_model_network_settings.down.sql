DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM settings WHERE key = 'model_network') THEN
        RAISE EXCEPTION 'model_network setting exists; cannot restore settings constraint';
    END IF;
END $$;

ALTER TABLE settings DROP CONSTRAINT settings_key_check,
    ADD CONSTRAINT settings_key_check CHECK (key IN ('branding', 'authentication', 'email', 'billing', 'session_reporting', 'proxies', 'mcp'));
