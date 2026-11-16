BEGIN;
ALTER TABLE environments DROP CONSTRAINT environments_phase_check;
ALTER TABLE environments ADD CONSTRAINT environments_phase_check CHECK(phase IN ('pending','preparing','starting','running','stopping','stopped','deleting','deleted','failed','protected'));

CREATE TABLE environment_protections (
 id uuid PRIMARY KEY,
 environment_id uuid NOT NULL REFERENCES environments(id),
 host_id uuid NOT NULL REFERENCES hosts(id),
 instance_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(reason='storage_pressure'),
 resolved_generation bigint,
 CHECK(resolved_generation IS NULL OR resolved_generation>generation)
);
CREATE UNIQUE INDEX environment_protections_open ON environment_protections(environment_id) WHERE resolved_generation IS NULL;
COMMIT;
