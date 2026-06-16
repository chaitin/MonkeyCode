ALTER TABLE skills ADD COLUMN IF NOT EXISTS extension_package_id character varying;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS extension_skill_id character varying;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS extension_version character varying;

ALTER TABLE images ADD COLUMN IF NOT EXISTS extension_package_id character varying;
ALTER TABLE images ADD COLUMN IF NOT EXISTS extension_image_id character varying;
ALTER TABLE images ADD COLUMN IF NOT EXISTS extension_version character varying;

CREATE INDEX IF NOT EXISTS idx_skills_extension_identity
    ON skills USING btree (extension_package_id, extension_skill_id)
    WHERE extension_package_id IS NOT NULL AND extension_skill_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_images_extension_identity
    ON images USING btree (extension_package_id, extension_image_id)
    WHERE extension_package_id IS NOT NULL AND extension_image_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS team_extension_image_archives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    image_id uuid NOT NULL,
    package_id character varying NOT NULL,
    extension_image_id character varying NOT NULL,
    version character varying NOT NULL,
    arch character varying NOT NULL,
    image_name character varying NOT NULL,
    archive_path character varying NOT NULL,
    archive_url character varying NOT NULL,
    sha256 character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_extension_image_archives_identity
    ON team_extension_image_archives USING btree (team_id, package_id, extension_image_id, arch);

CREATE INDEX IF NOT EXISTS idx_team_extension_image_archives_team_arch
    ON team_extension_image_archives USING btree (team_id, arch);
