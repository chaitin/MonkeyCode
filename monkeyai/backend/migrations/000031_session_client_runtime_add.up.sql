ALTER TABLE sessions
    DROP CONSTRAINT sessions_client_type_check,
    ADD CONSTRAINT sessions_client_type_check CHECK (
        client_type IN ('desktop', 'web', 'extension', 'mobile', 'runtime', 'unknown')
    );
