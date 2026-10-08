CREATE TABLE session_reporting_rate_limits (
    user_id uuid NOT NULL REFERENCES users(id),
    kind text NOT NULL CHECK (kind IN ('sessions', 'turns', 'endpoints')),
    bucket_start timestamptz NOT NULL,
    request_count integer NOT NULL CHECK (request_count > 0),
    PRIMARY KEY (user_id, kind)
);
