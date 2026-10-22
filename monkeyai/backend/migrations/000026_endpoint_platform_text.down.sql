-- 回滚前需处理旧枚举以外的平台记录；不要静默覆盖客户端上报的平台。
ALTER TABLE endpoints
    DROP CONSTRAINT endpoints_platform_check,
    ADD CONSTRAINT endpoints_platform_check CHECK (
        platform IN ('macos', 'windows', 'linux', 'ios', 'android', 'web')
    );
