ALTER TABLE models
    DROP CONSTRAINT models_kind_config_check,
    ADD CONSTRAINT models_kind_config_check CHECK (
        (kind = 'text' AND provider = 'passthrough'
            AND protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic')
            AND image_config IS NULL AND image_pricing IS NULL
            AND video_config IS NULL AND video_pricing IS NULL)
        OR (kind = 'image' AND provider <> 'passthrough' AND protocol = 'image_generation'
            AND image_config IS NOT NULL AND image_pricing IS NOT NULL
            AND video_config IS NULL AND video_pricing IS NULL
            AND advanced_config = '{}'::jsonb AND credit_multiplier = 1)
        OR (kind = 'video' AND provider IN ('xai', 'minimax') AND protocol = 'video_generation'
            AND image_config IS NULL AND image_pricing IS NULL
            AND video_config IS NOT NULL AND video_pricing IS NOT NULL
            AND advanced_config = '{}'::jsonb AND credit_multiplier = 1)
    );
