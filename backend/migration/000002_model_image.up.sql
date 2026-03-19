CREATE TABLE IF NOT EXISTS models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(255) NOT NULL,
    api_key text NOT NULL,
    base_url text NOT NULL,
    model character varying(255) NOT NULL,
    temperature real,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    remark character varying(128),
    interface_type character varying(255),
    last_check_at timestamp with time zone,
    last_check_success boolean,
    last_check_error text,
    weight integer DEFAULT 1 NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_models_api_key ON models USING btree (api_key);
CREATE INDEX IF NOT EXISTS idx_models_created_at_id ON models USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_models_model ON models USING btree (model);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models USING btree (provider);


CREATE TABLE IF NOT EXISTS images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    remark character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_images_created_at_id ON images USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_images_name ON images USING btree (name);


CREATE TABLE IF NOT EXISTS team_models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    model_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_models ON team_models USING btree (team_id, model_id);


CREATE TABLE IF NOT EXISTS team_group_models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    model_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_teams_group_models ON team_group_models USING btree (group_id, model_id) WHERE (deleted_at IS NULL);

CREATE TABLE IF NOT EXISTS team_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    image_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_images ON team_images USING btree (team_id, image_id);

CREATE TABLE IF NOT EXISTS team_group_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    image_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_group_images ON team_group_images USING btree (group_id, image_id) WHERE (deleted_at IS NULL);
