DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM skills WHERE ownership_type = 'system' AND deleted_at IS NULL
               GROUP BY lower(btrim(name)) HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM rules WHERE ownership_type = 'system' AND deleted_at IS NULL
                  GROUP BY lower(btrim(name)) HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM connectors WHERE ownership_type = 'system' AND deleted_at IS NULL
                  GROUP BY lower(btrim(name)) HAVING count(*) > 1)
       OR EXISTS (SELECT 1 FROM experts WHERE ownership_type = 'system' AND deleted_at IS NULL
                  GROUP BY lower(btrim(name)) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'cannot roll back resource origin while system resource names collide';
    END IF;
END $$;

DROP INDEX skills_system_name_key;
CREATE UNIQUE INDEX skills_system_name_key ON skills(lower(btrim(name)))
WHERE ownership_type = 'system' AND deleted_at IS NULL;
DROP INDEX rules_system_name_key;
CREATE UNIQUE INDEX rules_system_name_key ON rules(lower(btrim(name)))
WHERE ownership_type = 'system' AND deleted_at IS NULL;
DROP INDEX connectors_system_name_key;
CREATE UNIQUE INDEX connectors_system_name_key ON connectors(lower(btrim(name)))
WHERE ownership_type = 'system' AND deleted_at IS NULL;
DROP INDEX experts_system_name_key;
CREATE UNIQUE INDEX experts_system_name_key ON experts(lower(btrim(name)))
WHERE ownership_type = 'system' AND deleted_at IS NULL;

ALTER TABLE experts DROP COLUMN origin;
ALTER TABLE connectors DROP COLUMN origin;
ALTER TABLE rules DROP COLUMN origin;
ALTER TABLE skills DROP COLUMN origin;
