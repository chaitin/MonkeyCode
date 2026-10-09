ALTER TABLE models
    DROP CONSTRAINT models_kind_config_check,
    DROP CONSTRAINT models_video_config_check,
    DROP CONSTRAINT models_video_pricing_check,
    DROP CONSTRAINT models_kind_check,
    DROP CONSTRAINT models_protocol_check,
    ADD CONSTRAINT models_protocol_check CHECK (
        protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic', 'image_generation')
    ),
    ADD CONSTRAINT models_kind_check CHECK (kind IN ('text', 'image')),
    ADD CONSTRAINT models_kind_config_check CHECK (
        (kind = 'text' AND provider = 'passthrough' AND protocol <> 'image_generation'
            AND image_config IS NULL AND image_pricing IS NULL)
        OR (kind = 'image' AND provider <> 'passthrough' AND protocol = 'image_generation'
            AND image_config IS NOT NULL AND image_pricing IS NOT NULL
            AND advanced_config = '{}'::jsonb AND credit_multiplier = 1)
    ),
    DROP COLUMN video_config,
    DROP COLUMN video_pricing;
