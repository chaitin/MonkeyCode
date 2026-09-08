CREATE TABLE email_codes (
 email text NOT NULL,
 purpose text NOT NULL CHECK (purpose IN ('login', 'register', 'reset')),
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 ready boolean NOT NULL DEFAULT false,
 PRIMARY KEY (email, purpose)
);
CREATE TABLE email_code_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 email text NOT NULL,
 ip_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_code_deliveries_created_idx ON email_code_deliveries (created_at);
ALTER TABLE browser_sessions DROP CONSTRAINT browser_sessions_authentication_method_check;
ALTER TABLE browser_sessions ADD CONSTRAINT browser_sessions_authentication_method_check CHECK (authentication_method IN ('password', 'oauth', 'email_code'));
