BEGIN;
SET LOCAL lock_timeout = '2s';

-- 历史实时工具调用允许没有工具配置记录，不回填或改写调用历史。
DO $$
DECLARE source_table regclass;
    target_table regclass;
BEGIN
    SELECT source_relation, target_relation INTO STRICT source_table, target_table
    FROM billing_activity_partition_state WHERE table_name = 'mcp_tool_calls';
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT mcp_tool_calls_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES mcp_tools(id) NOT VALID', source_table);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT mcp_tool_calls_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES mcp_tools(id) NOT VALID', target_table);
END $$;
COMMIT;
