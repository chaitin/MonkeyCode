BEGIN;

ALTER TABLE user_identities
    DROP CONSTRAINT user_identities_provider_check,
    ADD CONSTRAINT user_identities_provider_check CHECK (
        provider IN ('github', 'google', 'microsoft', 'gitlab', 'oidc', 'baizhiyun')
    );

COMMIT;
