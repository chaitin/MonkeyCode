CREATE TABLE IF NOT EXISTS user_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_groups_admin_id_name ON user_groups (admin_id, name);

CREATE TABLE IF NOT EXISTS user_group_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_group_id UUID NOT NULL,
    user_id       UUID NOT NULL,
    FOREIGN KEY (user_group_id) REFERENCES user_groups (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_group_users_user_group_id_user_id ON user_group_users (user_group_id, user_id);

CREATE TABLE IF NOT EXISTS user_group_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_group_id UUID NOT NULL,
    admin_id      UUID NOT NULL,
    FOREIGN KEY (user_group_id) REFERENCES user_groups (id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_group_admins_user_group_id_admin_id ON user_group_admins (user_group_id, admin_id);

CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT, 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name ON roles (name);

CREATE TABLE IF NOT EXISTS admin_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL,
    role_id  BIGINT NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
);

INSERT INTO roles (id, name, description) VALUES
    (1, '超级管理员', '具有所有权限'),
    (2, '普通管理员', '管理组内成员的权限')
ON CONFLICT (id) DO NOTHING;

INSERT INTO admin_roles (admin_id, role_id)
SELECT a.id, 1
FROM admins a
ON CONFLICT DO NOTHING;