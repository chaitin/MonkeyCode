BEGIN;
DROP TABLE environment_quotas;
ALTER TABLE host_environment_configs DROP COLUMN user_max_environments;
COMMIT;
