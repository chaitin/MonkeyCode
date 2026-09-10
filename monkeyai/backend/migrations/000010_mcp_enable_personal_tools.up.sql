UPDATE mcp_tools t
SET enabled = true,
    updated_at = now()
FROM connectors c
WHERE c.id = t.connector_id
    AND c.ownership_type = 'user'
    AND c.deleted_at IS NULL
    AND t.config_revision = c.config_revision
    AND t.deleted_at IS NULL
    AND NOT t.enabled;
