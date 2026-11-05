BEGIN;
CREATE TABLE IF NOT EXISTS environment_scheduling (
 host_id uuid PRIMARY KEY REFERENCES environment_hosts(host_id) ON DELETE CASCADE,
 weight bigint NOT NULL CHECK (weight BETWEEN 1 AND 4096000),
 current_weight bigint NOT NULL DEFAULT 0
);
COMMIT;
