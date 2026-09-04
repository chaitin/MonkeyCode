BEGIN;

DROP TABLE audits;
DROP TABLE credit_ledger_entries;
DROP TABLE credit_accounts;
DROP TABLE billing_quotas;
DROP TABLE mcp_tool_calls;
DROP TABLE model_calls;
DROP TABLE sessions;
DROP TABLE expert_skills;
DROP TABLE expert_rules;
DROP TABLE expert_mcp_tools;
DROP TABLE resource_tags;
DROP TABLE resource_access_grants;
DROP TABLE experts;
DROP TABLE mcp_tools;
DROP TABLE mcp_server_credentials;
DROP TABLE mcp_servers;
DROP TABLE rules;
DROP TABLE skills;
DROP TABLE tags;
DROP TABLE models;
DROP TABLE settings;
DROP TABLE group_users;
DROP TABLE groups;
DROP TABLE user_identities;
DROP TABLE users;

COMMIT;
