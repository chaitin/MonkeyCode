BEGIN;
WITH changed AS (
 UPDATE oauth_grants SET
 scopes=array_remove(array_remove(scopes,'environment:read'),'environment:manage'),
 revoked_at=COALESCE(revoked_at,now()),
 revoke_reason=COALESCE(revoke_reason,'environment_scope_rollback'),
 revocation_version=revocation_version+1
 WHERE scopes && ARRAY['environment:read','environment:manage']::text[]
 RETURNING id
)
UPDATE oauth_tokens SET revoked_at=COALESCE(revoked_at,now())
WHERE grant_id IN (SELECT id FROM changed);
UPDATE oauth_authorization_requests SET expires_at=LEAST(expires_at,now())
WHERE scopes && ARRAY['environment:read','environment:manage']::text[];
UPDATE oauth_authorization_codes SET expires_at=LEAST(expires_at,now())
WHERE scopes && ARRAY['environment:read','environment:manage']::text[];
ALTER TABLE oauth_grants DROP CONSTRAINT oauth_grants_scopes_check;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes_check CHECK (
 scopes <@ ARRAY['device:bind','device:publish','device:connect','device:manage',
 'session:report','session:read','session:control','files:read','files:write','resources:manage']::text[]
);
COMMIT;
