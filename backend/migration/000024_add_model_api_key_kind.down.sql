ALTER TABLE model_api_keys
    DROP CONSTRAINT IF EXISTS model_api_keys_kind_check;

DELETE FROM model_api_keys
    WHERE kind = 'ohmyagent';

ALTER TABLE model_api_keys
    DROP COLUMN IF EXISTS kind,
    DROP COLUMN IF EXISTS signing_secret;

ALTER TABLE model_api_keys
    ALTER COLUMN model_id SET NOT NULL;
