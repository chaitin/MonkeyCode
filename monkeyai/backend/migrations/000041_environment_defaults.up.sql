BEGIN;
CREATE TABLE IF NOT EXISTS environment_defaults (
 id integer PRIMARY KEY CHECK (id=1),
 revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
 preset_id uuid REFERENCES environment_presets(id),
 max_environments integer NOT NULL CHECK (max_environments BETWEEN 0 AND 1000),
 max_running integer NOT NULL CHECK (max_running BETWEEN 0 AND max_environments),
 cpu_millis bigint NOT NULL CHECK (cpu_millis BETWEEN 0 AND 4096000),
 memory_bytes bigint NOT NULL CHECK (memory_bytes BETWEEN 0 AND 17592186044416)
);
INSERT INTO environment_defaults(id,max_environments,max_running,cpu_millis,memory_bytes)
VALUES(1,3,2,8000,17179869184) ON CONFLICT(id) DO NOTHING;
COMMIT;
