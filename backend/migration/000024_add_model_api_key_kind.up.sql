ALTER TABLE model_api_keys
    ALTER COLUMN model_id DROP NOT NULL;

ALTER TABLE model_api_keys
    ADD COLUMN IF NOT EXISTS kind VARCHAR(32) NOT NULL DEFAULT 'runtime',
    ADD COLUMN IF NOT EXISTS signing_secret TEXT NOT NULL DEFAULT '';

ALTER TABLE model_api_keys
    ADD CONSTRAINT model_api_keys_kind_check
    CHECK (
        (kind = 'runtime' AND model_id IS NOT NULL)
        OR (
            kind = 'ohmyagent'
            AND model_id IS NULL
            AND signing_secret <> ''
            AND (virtualmachine_id IS NULL OR virtualmachine_id = '')
        )
    );
