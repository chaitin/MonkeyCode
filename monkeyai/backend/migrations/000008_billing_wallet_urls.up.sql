ALTER TABLE wallet_billing_records RENAME COLUMN environment TO base_url;

UPDATE wallet_billing_records
SET base_url = CASE base_url
    WHEN 'dev' THEN 'https://baizhiyun.vip'
    WHEN 'prod' THEN 'https://baizhi.cloud'
    ELSE base_url END;

UPDATE settings
SET value = jsonb_set(value, '{wallet}', ((value->'wallet') - 'environment') || jsonb_build_object(
    'base_url', CASE value#>>'{wallet,environment}'
        WHEN 'dev' THEN 'https://baizhiyun.vip'
        WHEN 'prod' THEN 'https://baizhi.cloud' END
))
WHERE key = 'billing' AND value#>>'{wallet,environment}' IN ('dev', 'prod');
