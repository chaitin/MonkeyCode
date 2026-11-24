ALTER TABLE settings DROP CONSTRAINT settings_key_check,
    ADD CONSTRAINT settings_key_check CHECK (key IN ('branding', 'authentication', 'email', 'billing', 'session_reporting', 'proxies', 'mcp', 'model_network'));
