-- 回滚前需处理 runtime 会话，保留原始上报类型，不静默改写历史数据。
ALTER TABLE sessions
    DROP CONSTRAINT sessions_client_type_check,
    ADD CONSTRAINT sessions_client_type_check CHECK (
        client_type IN ('desktop', 'web', 'extension', 'mobile', 'unknown')
    );
