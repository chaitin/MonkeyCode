BEGIN;
CREATE TABLE IF NOT EXISTS environment_specification_catalog (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO environment_specification_catalog (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS environment_specifications (
    id uuid PRIMARY KEY,
    version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
    cpu_millis bigint NOT NULL CHECK (cpu_millis BETWEEN 100 AND 256000),
    memory_bytes bigint NOT NULL CHECK (memory_bytes BETWEEN 268435456 AND 1099511627776),
    position integer NOT NULL CHECK (position >= 0),
    deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS environment_specifications_active_resources
    ON environment_specifications (cpu_millis, memory_bytes) WHERE deleted_at IS NULL;
-- 仅初始化全新目录；管理员删除或清空后不自动补回。
INSERT INTO environment_specifications (id, cpu_millis, memory_bytes, position)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, 1000, 2147483648, 0
WHERE NOT EXISTS (SELECT 1 FROM environment_specifications)
  AND EXISTS (SELECT 1 FROM environment_specification_catalog WHERE singleton AND revision = 0);
COMMIT;
