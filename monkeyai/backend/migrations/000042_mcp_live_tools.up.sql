BEGIN;
SET LOCAL lock_timeout = '2s';

-- 工具调用保留稳定工具标识，工具目录不再要求持久化；兼容调用表在线分区切换后的名称。
DO $$
DECLARE source_table regclass;
    target_table regclass;
BEGIN
    SELECT source_relation, target_relation INTO STRICT source_table, target_table
    FROM billing_activity_partition_state WHERE table_name = 'mcp_tool_calls';
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS mcp_tool_calls_tool_id_fkey', source_table);
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS mcp_tool_calls_tool_id_fkey', target_table);
END $$;
COMMIT;
