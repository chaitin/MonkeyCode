BEGIN;
CREATE TABLE IF NOT EXISTS engine_upgrades (
 host_id uuid PRIMARY KEY REFERENCES engine_hosts(id),
 id uuid NOT NULL UNIQUE,
 version text NOT NULL,
 installer_sha256 text NOT NULL,
 manifest_sha256 text NOT NULL,
 status text NOT NULL CHECK (status IN ('pending','running','succeeded','failed')),
 reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
