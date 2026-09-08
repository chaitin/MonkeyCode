BEGIN;

ALTER TABLE resource_access_grants
    ADD COLUMN all_users boolean NOT NULL DEFAULT false,
    DROP CONSTRAINT resource_access_grants_subject_check,
    ADD CONSTRAINT resource_access_grants_subject_check CHECK (
        (user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer + all_users::integer = 1
    );

CREATE UNIQUE INDEX resource_access_grants_all_users_key
    ON resource_access_grants (resource_type, resource_id)
    WHERE all_users;

COMMIT;
