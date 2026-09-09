BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM user_identities WHERE provider = 'baizhiyun')
        OR EXISTS (SELECT 1 FROM settings WHERE key = 'authentication'
            AND value @> '{"oauth_connections":[{"provider":"baizhiyun"}]}') THEN
        RAISE EXCEPTION '存在百智云登录配置或身份，不能回滚';
    END IF;
END $$;

ALTER TABLE user_identities
    DROP CONSTRAINT user_identities_provider_check,
    ADD CONSTRAINT user_identities_provider_check CHECK (
        provider IN ('github', 'google', 'microsoft', 'gitlab', 'oidc')
    );

COMMIT;
