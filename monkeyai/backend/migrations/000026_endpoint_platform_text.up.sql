ALTER TABLE endpoints
    DROP CONSTRAINT endpoints_platform_check,
    ADD CONSTRAINT endpoints_platform_check CHECK (octet_length(platform) BETWEEN 1 AND 64);
