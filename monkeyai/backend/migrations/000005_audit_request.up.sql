ALTER TABLE audits ADD COLUMN request_id text;
CREATE INDEX audits_request_idx ON audits (request_id) WHERE request_id IS NOT NULL;
