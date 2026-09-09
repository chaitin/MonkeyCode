DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM wallet_billing_records
        WHERE base_url NOT IN ('https://baizhiyun.vip', 'https://baizhi.cloud')
    ) OR EXISTS (
        SELECT 1 FROM settings WHERE key = 'billing'
        AND value#>>'{wallet,base_url}' NOT IN ('https://baizhiyun.vip', 'https://baizhi.cloud')
    ) THEN
        RAISE EXCEPTION '旧版本不支持自定义百智云 URL，无法回退当前连接配置或交易记录';
    END IF;
END $$;

UPDATE settings
SET value = jsonb_set(value, '{wallet}', ((value->'wallet') - 'base_url') || jsonb_build_object(
    'environment', CASE value#>>'{wallet,base_url}'
        WHEN 'https://baizhiyun.vip' THEN 'dev'
        WHEN 'https://baizhi.cloud' THEN 'prod' END
))
WHERE key = 'billing' AND value#>>'{wallet,base_url}' IS NOT NULL;

UPDATE wallet_billing_records
SET base_url = CASE base_url
    WHEN 'https://baizhiyun.vip' THEN 'dev'
    WHEN 'https://baizhi.cloud' THEN 'prod' END;

ALTER TABLE wallet_billing_records RENAME COLUMN base_url TO environment;
