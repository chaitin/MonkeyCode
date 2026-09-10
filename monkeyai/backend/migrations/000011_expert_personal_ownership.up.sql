ALTER TABLE experts
    ADD COLUMN ownership_type text NOT NULL DEFAULT 'system'
        CHECK (ownership_type IN ('system', 'user')),
    ADD COLUMN owner_user_id uuid REFERENCES users(id);

UPDATE experts SET owner_user_id = created_by_user_id;
ALTER TABLE experts ALTER COLUMN owner_user_id SET NOT NULL;

DROP INDEX experts_name_key;
CREATE UNIQUE INDEX experts_system_name_key ON experts(lower(btrim(name)))
    WHERE ownership_type = 'system' AND deleted_at IS NULL;
CREATE UNIQUE INDEX experts_user_name_key ON experts(owner_user_id, lower(btrim(name)))
    WHERE ownership_type = 'user' AND deleted_at IS NULL;
