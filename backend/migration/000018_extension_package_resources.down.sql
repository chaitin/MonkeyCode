DROP TABLE IF EXISTS team_extension_image_archives;

DROP INDEX IF EXISTS idx_images_extension_identity;
DROP INDEX IF EXISTS idx_skills_extension_identity;

ALTER TABLE images DROP COLUMN IF EXISTS extension_version;
ALTER TABLE images DROP COLUMN IF EXISTS extension_image_id;
ALTER TABLE images DROP COLUMN IF EXISTS extension_package_id;

ALTER TABLE skills DROP COLUMN IF EXISTS extension_version;
ALTER TABLE skills DROP COLUMN IF EXISTS extension_skill_id;
ALTER TABLE skills DROP COLUMN IF EXISTS extension_package_id;
