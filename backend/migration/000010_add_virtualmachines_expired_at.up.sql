ALTER TABLE virtualmachines
    ADD COLUMN IF NOT EXISTS expired_at timestamp with time zone;

UPDATE virtualmachines
SET expired_at = created_at + (ttl * interval '1 second')
WHERE expired_at IS NULL
  AND ttl_kind = 'countdown'
  AND ttl IS NOT NULL
  AND ttl > 0;
