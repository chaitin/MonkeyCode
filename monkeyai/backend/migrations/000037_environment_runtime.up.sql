BEGIN;
CREATE TABLE environment_runtime (
 environment_id uuid PRIMARY KEY REFERENCES environments(id),
 machine_id uuid NOT NULL UNIQUE,
 public_key bytea NOT NULL CHECK(octet_length(public_key)=32),
 instance_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
