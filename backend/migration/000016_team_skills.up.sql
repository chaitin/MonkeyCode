CREATE TABLE IF NOT EXISTS skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone,
    user_id uuid NOT NULL,
    name character varying NOT NULL,
    description text NOT NULL,
    tags jsonb,
    content text NOT NULL,
    package_object_key character varying,
    package_url character varying,
    source_type character varying NOT NULL,
    source_label character varying NOT NULL,
    skill_md_path character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_created_at_id ON skills USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_skills_user_id ON skills USING btree (user_id);

CREATE TABLE IF NOT EXISTS team_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_skills_team_skill ON team_skills USING btree (team_id, skill_id);

CREATE TABLE IF NOT EXISTS team_group_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_group_skills_created_at_id ON team_group_skills USING btree (created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_team_group_skills_group_skill ON team_group_skills USING btree (group_id, skill_id);
