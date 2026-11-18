BEGIN;
ALTER TABLE host_environment_configs ADD COLUMN user_max_environments integer NOT NULL DEFAULT 3 CHECK(user_max_environments BETWEEN 0 AND 1000000);
CREATE TABLE environment_quotas (
 host_id uuid NOT NULL REFERENCES hosts(id),
 user_id uuid NOT NULL REFERENCES users(id),
 max_environments integer NOT NULL CHECK(max_environments BETWEEN 0 AND 1000000),
 PRIMARY KEY(host_id,user_id)
);
CREATE INDEX environment_quotas_user_idx ON environment_quotas(user_id,host_id);
COMMIT;
