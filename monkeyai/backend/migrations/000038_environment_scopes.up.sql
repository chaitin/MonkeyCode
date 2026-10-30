BEGIN;
ALTER TABLE oauth_grants DROP CONSTRAINT oauth_grants_scopes_check;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes_check CHECK (
 scopes <@ ARRAY['device:bind','device:publish','device:connect','device:manage',
 'session:report','session:read','session:control','files:read','files:write','resources:manage',
 'environment:read','environment:manage']::text[]
);
COMMIT;
