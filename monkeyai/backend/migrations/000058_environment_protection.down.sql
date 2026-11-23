BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM environments WHERE phase='protected') OR EXISTS(SELECT 1 FROM environment_protections WHERE resolved_generation IS NULL) THEN
  RAISE EXCEPTION '存在未解除的环境存储保护，禁止回退';
 END IF;
END $$;
DROP TABLE environment_protections;
ALTER TABLE environments DROP CONSTRAINT environments_phase_check;
ALTER TABLE environments ADD CONSTRAINT environments_phase_check CHECK(phase IN ('pending','preparing','starting','running','stopping','stopped','deleting','deleted','failed'));
COMMIT;
