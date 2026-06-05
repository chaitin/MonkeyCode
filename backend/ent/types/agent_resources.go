package types

// SkillParsedMeta is the parsed_meta jsonb payload for agent_skill_versions.
// It mirrors the SKILL.md frontmatter.
type SkillParsedMeta struct {
	Description string   `json:"description,omitempty"`
	Categories  []string `json:"categories,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

// PluginParsedMeta is the parsed_meta jsonb payload for agent_plugin_versions.
type PluginParsedMeta struct {
	Entry string `json:"entry"`
}

// PluginManualEntry is one item in agent_plugin_repos.plugin_manual_entries.
type PluginManualEntry struct {
	Name       string `json:"name"`
	Entrypoint string `json:"entrypoint"`
}

// PluginManualEntries is the jsonb array stored on agent_plugin_repos.
type PluginManualEntries []PluginManualEntry

// SyncJobError describes a single failure entry recorded on agent_sync_jobs.errors.
type SyncJobError struct {
	Dir    string `json:"dir,omitempty"`
	Reason string `json:"reason"`
	Detail string `json:"detail,omitempty"`
}

// SyncJobErrors is the jsonb array stored on agent_sync_jobs.errors.
type SyncJobErrors []SyncJobError

// SyncJobResultSummary is the jsonb payload stored on agent_sync_jobs.result_summary.
type SyncJobResultSummary struct {
	Created  []string `json:"created,omitempty"`
	Updated  []string `json:"updated,omitempty"`
	Orphaned []string `json:"orphaned,omitempty"`
}
