-- 回滚前需先迁出 image 模型；本迁移不自动删除用户数据。
ALTER TABLE models
    DROP CONSTRAINT models_kind_config_check,
    DROP CONSTRAINT models_image_pricing_check,
    DROP CONSTRAINT models_image_config_check,
    DROP CONSTRAINT models_provider_options_check,
    DROP CONSTRAINT models_kind_check,
    DROP CONSTRAINT models_protocol_check,
    ADD CONSTRAINT models_protocol_check CHECK (
        protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic')
    );

ALTER TABLE models
    DROP COLUMN image_pricing,
    DROP COLUMN image_config,
    DROP COLUMN provider_options,
    DROP COLUMN provider,
    DROP COLUMN kind;
