ALTER TABLE model_calls
    ADD COLUMN first_token_duration_ms integer
    CHECK (first_token_duration_ms IS NULL OR first_token_duration_ms >= 0);
