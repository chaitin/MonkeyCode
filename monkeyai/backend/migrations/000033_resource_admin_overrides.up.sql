ALTER TABLE skills
    ADD COLUMN admin_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(admin_overrides) = 'object');
ALTER TABLE rules
    ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN admin_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(admin_overrides) = 'object');
ALTER TABLE connectors
    ADD COLUMN admin_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(admin_overrides) = 'object');
ALTER TABLE experts
    ADD COLUMN admin_overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(admin_overrides) = 'object');
