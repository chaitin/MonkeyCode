BEGIN;
DROP INDEX oauth_device_requests_owner_approved;
DROP TABLE profile_password_attempts;
ALTER TABLE users DROP COLUMN custom_avatar_url;
COMMIT;
