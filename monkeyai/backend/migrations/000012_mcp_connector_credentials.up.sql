BEGIN;

CREATE TABLE expert_connectors (
    expert_id uuid NOT NULL REFERENCES experts(id),
    connector_id uuid NOT NULL REFERENCES connectors(id),
    required boolean NOT NULL DEFAULT true,
    tool_allowlist text[] NOT NULL DEFAULT '{}',
    tool_denylist text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (expert_id, connector_id)
);
CREATE INDEX expert_connectors_connector_idx ON expert_connectors(connector_id);

-- 多候选依赖通过连接参数 monkeyai.connector_mappings 显式指定：{"专家ID":{"模板ID":"连接ID"}}。
DO $$
DECLARE
    link record;
    selected uuid;
    candidates uuid[];
    mappings jsonb := COALESCE(NULLIF(current_setting('monkeyai.connector_mappings', true), ''), '{}')::jsonb;
    issues jsonb := '[]'::jsonb;
BEGIN
    FOR link IN
        SELECT x.*, e.ownership_type, e.owner_user_id
        FROM expert_connector_providers x JOIN experts e ON e.id = x.expert_id
        WHERE e.deleted_at IS NULL
    LOOP
        WITH RECURSIVE user_groups AS (
            SELECT g.id, g.parent_id FROM groups g JOIN group_users gu ON gu.group_id = g.id
            WHERE gu.user_id = link.owner_user_id AND gu.removed_at IS NULL AND g.deleted_at IS NULL
            UNION
            SELECT p.id, p.parent_id FROM groups p JOIN user_groups child ON child.parent_id = p.id
            WHERE p.deleted_at IS NULL
        )
        SELECT array_agg(c.id ORDER BY c.id) INTO candidates
        FROM connectors c
        WHERE c.provider_id = link.provider_id AND c.deleted_at IS NULL AND c.enabled
            AND (link.ownership_type = 'system' AND c.ownership_type = 'system'
                OR link.ownership_type = 'user' AND EXISTS (
                    SELECT 1 FROM users u WHERE u.id = link.owner_user_id AND u.status = 'active' AND u.deleted_at IS NULL
                ) AND (c.ownership_type = 'user' AND c.owner_user_id = link.owner_user_id
                    OR EXISTS (SELECT 1 FROM resource_access_grants g
                        WHERE g.resource_type = 'connector' AND g.resource_id = c.id
                            AND (g.all_users OR g.user_id = link.owner_user_id OR g.group_id IN (SELECT id FROM user_groups))))
                AND (c.ownership_type = 'user'
                    OR NOT EXISTS (SELECT 1 FROM settings WHERE key = 'billing' AND value->>'charging_mode' = 'remote')
                    OR EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = link.owner_user_id
                        AND i.provider = 'baizhiyun' AND i.deleted_at IS NULL)));
        selected := (mappings -> link.expert_id::text ->> link.provider_id::text)::uuid;
        IF selected IS NULL AND cardinality(candidates) = 1 THEN
            selected := candidates[1];
        END IF;
        IF selected IS NULL OR NOT COALESCE(selected = ANY(candidates), false) THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
                'expert_id', link.expert_id, 'provider_id', link.provider_id,
                'candidates', COALESCE(to_jsonb(candidates), '[]'::jsonb),
                'reason', CASE WHEN selected IS NOT NULL THEN 'invalid_mapping' WHEN COALESCE(cardinality(candidates),0) = 0 THEN 'missing_connector' ELSE 'ambiguous_connector' END));
        ELSE
            INSERT INTO expert_connectors(expert_id, connector_id, required, tool_allowlist, tool_denylist)
            VALUES(link.expert_id, selected, link.required, link.tool_allowlist, link.tool_denylist);
        END IF;
    END LOOP;
    IF jsonb_array_length(issues) > 0 THEN
        RAISE EXCEPTION '专家连接映射不完整，请设置 monkeyai.connector_mappings；未修改原数据。% ', issues;
    END IF;
END $$;

ALTER TABLE connectors ADD COLUMN icon_s3_key text NOT NULL DEFAULT '';
UPDATE connectors c SET icon_s3_key = p.icon_s3_key,
    enabled = c.enabled AND p.enabled AND p.deleted_at IS NULL
FROM connector_providers p WHERE c.provider_id = p.id;

ALTER TABLE connector_credentials
    DROP CONSTRAINT connector_credentials_connector_id_user_id_key,
    ADD COLUMN name text NOT NULL DEFAULT '原有凭证' CHECK (char_length(btrim(name)) BETWEEN 1 AND 128),
    ADD COLUMN revision bigint NOT NULL DEFAULT 1,
    ADD COLUMN connection_status text NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown','connected','error')),
    ADD COLUMN last_checked_at timestamptz,
    ADD COLUMN last_error text;
UPDATE connector_credentials SET revoked_at = COALESCE(revoked_at, now()) WHERE status = 'revoked';
UPDATE connector_credentials SET http_headers = '{}', oauth_access_token = '', oauth_refresh_token = '',
    oauth_expires_at = now(), revision = revision + 1
WHERE status = 'error' OR (status = 'expired' AND oauth_refresh_token = '');
UPDATE connector_credentials cc SET revoked_at = COALESCE(cc.revoked_at, now())
FROM connectors c WHERE c.id = cc.connector_id AND (c.authorization_mode = 'none'
    OR (c.authorization_mode = 'centralized' AND cc.user_id IS NOT NULL)
    OR (c.authorization_mode = 'independent' AND cc.user_id IS NULL)
    OR cc.method IS DISTINCT FROM c.authorization_method);
UPDATE connector_credentials cc SET http_headers = '{}' FROM connectors c
WHERE c.id = cc.connector_id AND c.authorization_method IS DISTINCT FROM 'http_header';
UPDATE connector_credentials cc SET oauth_access_token = '', oauth_refresh_token = '', oauth_expires_at = NULL
FROM connectors c WHERE c.id = cc.connector_id AND c.authorization_method IS DISTINCT FROM 'oauth';
ALTER TABLE connector_credentials DROP COLUMN method, DROP COLUMN status;
CREATE INDEX connector_credentials_user_idx ON connector_credentials(connector_id, user_id);
CREATE UNIQUE INDEX connector_credentials_centralized_idx ON connector_credentials(connector_id)
    WHERE user_id IS NULL AND revoked_at IS NULL;
ALTER TABLE connector_credentials ADD CONSTRAINT connector_credentials_id_connector_key UNIQUE(id, connector_id);
ALTER TABLE mcp_tools ADD CONSTRAINT mcp_tools_credential_connector_fkey
    FOREIGN KEY (credential_id, connector_id) REFERENCES connector_credentials(id, connector_id);
UPDATE mcp_tools t SET deleted_at = COALESCE(t.deleted_at, now())
FROM connector_credentials cc WHERE t.credential_id = cc.id
    AND (cc.revoked_at IS NOT NULL OR (cc.http_headers = '{}' AND cc.oauth_access_token = '' AND cc.oauth_refresh_token = ''));

ALTER TABLE connector_oauth_requests
    ADD COLUMN credential_id uuid REFERENCES connector_credentials(id),
    ADD COLUMN credential_revision bigint,
    ADD COLUMN name text NOT NULL DEFAULT '原有凭证',
    DROP COLUMN centralized;
UPDATE connector_oauth_requests SET status = CASE WHEN status = 'authorized' THEN 'succeeded' ELSE 'failed' END;
ALTER TABLE connector_oauth_requests ADD CONSTRAINT connector_oauth_requests_status_check
    CHECK (status IN ('pending','processing','succeeded','failed','expired'));
CREATE INDEX connector_oauth_requests_expires_idx ON connector_oauth_requests(expires_at);

DROP TABLE expert_connector_providers;
ALTER TABLE connectors DROP COLUMN provider_id;
DROP TABLE connector_providers;
COMMIT;
