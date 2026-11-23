BEGIN;
WITH revoked AS (
 UPDATE oauth_grants SET scopes=array_remove(scopes,'account:ai-resources'),
 revoked_at=coalesce(revoked_at,now()), revoke_reason=coalesce(revoke_reason,'resource_scope_rollback'),
 revocation_version=revocation_version+1 WHERE 'account:ai-resources'=ANY(scopes) RETURNING id
)
UPDATE oauth_tokens SET revoked_at=coalesce(revoked_at,now()) WHERE grant_id IN (SELECT id FROM revoked);
UPDATE oauth_device_requests SET status='expired' WHERE status IN ('pending','approved') AND 'account:ai-resources'=ANY(requested_scopes);
ALTER TABLE oauth_grants DROP CONSTRAINT IF EXISTS oauth_grants_scopes_check;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes_check CHECK(
 scopes <@ ARRAY['device:bind','device:publish','device:connect','device:manage',
 'session:report','session:read','session:control','files:read','files:write','resources:manage',
 'environment:read','environment:manage']::text[]
);
COMMIT;
