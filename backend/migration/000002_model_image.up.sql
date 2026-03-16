CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    api_key VARCHAR(512) NOT NULL,
    base_url VARCHAR(512) NOT NULL,
    model VARCHAR(255) NOT NULL,
    remark VARCHAR(512),
    temperature DOUBLE PRECISION DEFAULT 0,
    interface_type VARCHAR(50) DEFAULT '',
    weight INTEGER DEFAULT 0,
    last_check_at TIMESTAMP WITH TIME ZONE,
    last_check_success BOOLEAN DEFAULT FALSE,
    last_check_error VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS images (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    remark VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS team_models (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(team_id, model_id)
);

CREATE TABLE IF NOT EXISTS team_group_models (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES team_groups(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, model_id)
);

CREATE TABLE IF NOT EXISTS team_images (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(team_id, image_id)
);

CREATE TABLE IF NOT EXISTS team_group_images (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES team_groups(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, image_id)
);

CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);
CREATE INDEX IF NOT EXISTS idx_models_deleted_at ON models(deleted_at);
CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);
CREATE INDEX IF NOT EXISTS idx_images_deleted_at ON images(deleted_at);
CREATE INDEX IF NOT EXISTS idx_team_models_team_id ON team_models(team_id);
CREATE INDEX IF NOT EXISTS idx_team_models_model_id ON team_models(model_id);
CREATE INDEX IF NOT EXISTS idx_team_group_models_group_id ON team_group_models(group_id);
CREATE INDEX IF NOT EXISTS idx_team_group_models_model_id ON team_group_models(model_id);
CREATE INDEX IF NOT EXISTS idx_team_images_team_id ON team_images(team_id);
CREATE INDEX IF NOT EXISTS idx_team_images_image_id ON team_images(image_id);
CREATE INDEX IF NOT EXISTS idx_team_group_images_group_id ON team_group_images(group_id);
CREATE INDEX IF NOT EXISTS idx_team_group_images_image_id ON team_group_images(image_id);
