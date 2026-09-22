ALTER TABLE models
    ADD COLUMN kind text NOT NULL DEFAULT 'text',
    ADD COLUMN provider text NOT NULL DEFAULT 'passthrough',
    ADD COLUMN provider_options jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN image_config jsonb,
    ADD COLUMN image_pricing jsonb;

ALTER TABLE models
    DROP CONSTRAINT models_protocol_check,
    ADD CONSTRAINT models_protocol_check CHECK (
        protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic', 'image_generation')
    ),
    ADD CONSTRAINT models_kind_check CHECK (kind IN ('text', 'image')),
    ADD CONSTRAINT models_provider_options_check CHECK (jsonb_typeof(provider_options) = 'object'),
    ADD CONSTRAINT models_image_config_check CHECK (image_config IS NULL OR jsonb_typeof(image_config) = 'object'),
    ADD CONSTRAINT models_image_pricing_check CHECK (image_pricing IS NULL OR jsonb_typeof(image_pricing) = 'object'),
    ADD CONSTRAINT models_kind_config_check CHECK (
        (kind = 'text' AND provider = 'passthrough' AND protocol <> 'image_generation'
            AND image_config IS NULL AND image_pricing IS NULL)
        OR (kind = 'image' AND provider <> 'passthrough' AND protocol = 'image_generation'
            AND image_config IS NOT NULL AND image_pricing IS NOT NULL
            AND advanced_config = '{}'::jsonb AND credit_multiplier = 1)
    );
