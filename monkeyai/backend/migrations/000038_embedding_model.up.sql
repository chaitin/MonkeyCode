ALTER TABLE models
    ADD COLUMN embedding_config jsonb;

ALTER TABLE models
    DROP CONSTRAINT models_protocol_check,
    ADD CONSTRAINT models_protocol_check CHECK (
        protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic', 'image_generation', 'video_generation', 'openai_embeddings')
    ),
    DROP CONSTRAINT models_kind_check,
    ADD CONSTRAINT models_kind_check CHECK (kind IN ('text', 'image', 'video', 'embedding')),
    ADD CONSTRAINT models_embedding_config_check CHECK (embedding_config IS NULL OR jsonb_typeof(embedding_config) = 'object'),
    DROP CONSTRAINT models_kind_config_check,
    ADD CONSTRAINT models_kind_config_check CHECK (
        (kind = 'text' AND provider = 'passthrough'
            AND protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic')
            AND image_config IS NULL AND image_pricing IS NULL
            AND video_config IS NULL AND video_pricing IS NULL
            AND embedding_config IS NULL)
        OR (kind = 'image' AND provider <> 'passthrough' AND protocol = 'image_generation'
            AND image_config IS NOT NULL AND image_pricing IS NOT NULL
            AND video_config IS NULL AND video_pricing IS NULL
            AND embedding_config IS NULL
            AND advanced_config = '{}'::jsonb AND credit_multiplier = 1)
        OR (kind = 'video' AND provider IN ('xai', 'minimax', 'volcengine', 'agnes') AND protocol = 'video_generation'
            AND image_config IS NULL AND image_pricing IS NULL
            AND video_config IS NOT NULL AND video_pricing IS NOT NULL
            AND embedding_config IS NULL
            AND advanced_config = '{}'::jsonb AND credit_multiplier = 1)
        OR (kind = 'embedding' AND provider = 'passthrough' AND protocol = 'openai_embeddings'
            AND embedding_config IS NOT NULL
            AND image_config IS NULL AND image_pricing IS NULL
            AND video_config IS NULL AND video_pricing IS NULL
            AND advanced_config = '{}'::jsonb)
    );
