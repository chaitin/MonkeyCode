BEGIN;

-- avatar_url remains owned by OAuth synchronization. Manual uploads never
-- change it, so clearing the override restores the latest provider avatar.
ALTER TABLE users ADD COLUMN custom_avatar_url text;

CREATE TABLE profile_password_attempts (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    window_started_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0)
);

-- Password changes revoke approvals that have not yet been exchanged.
CREATE INDEX oauth_device_requests_owner_approved
    ON oauth_device_requests(owner_user_id,id) WHERE status='approved';

COMMIT;
