// Package agentresource exposes read-only repository helpers for the agent
// rule / skill / plugin resources consumed by the task dispatch path.
//
// The package is intentionally narrow: it only surfaces the data needed by
// (a) the task usecase when assembling getCodingConfigs, and (b) the public
// list endpoints under /api/v1/skills + /api/v1/plugins. Mutations live in
// the admin BFF, not here.
package agentresource

import (
	"time"

	"github.com/google/uuid"

	enttypes "github.com/chaitin/MonkeyCode/backend/ent/types"
)

// RuleWithVersion is an agent rule joined with the row referenced by its
// active_version_id. Rule content is sourced directly from the
// agent_rule_versions.content column — there is no S3 indirection for rules
// (unlike skill / plugin which still go through S3-backed zip artifacts).
type RuleWithVersion struct {
	ID        uuid.UUID
	Name      string
	Version   string
	Content   string
	UpdatedAt time.Time
}

// SkillWithVersion is an agent skill joined with the row referenced by its
// active_version_id. Orphaned skills (is_orphan=true) are kept on purpose
// so that previously active versions remain deliverable until the operator
// explicitly deletes them.
type SkillWithVersion struct {
	ID              uuid.UUID
	Name            string
	Description     string
	Version         string
	S3Key           string
	IsForceDelivery bool
	IsOrphan        bool
	ParsedMeta      enttypes.SkillParsedMeta
	UpdatedAt       time.Time
}

// PluginWithVersion mirrors SkillWithVersion but for plugins. The Entry
// field is hoisted out of parsed_meta because the task dispatch path needs
// it as a flat string.
type PluginWithVersion struct {
	ID              uuid.UUID
	Name            string
	Description     string
	Version         string
	S3Key           string
	IsForceDelivery bool
	IsOrphan        bool
	Entry           string
	UpdatedAt       time.Time
}

// ResourceListItem is the lightweight projection returned to the public
// listing endpoints (skills / plugins). It deliberately omits S3 keys and
// orphan markers because those are dispatch-time concerns.
//
// Entry is only meaningful for plugins (taken from parsed_meta.entry) so
// the picker UI can preview where the plugin will be mounted; it is left
// empty for skills.
type ResourceListItem struct {
	ID              uuid.UUID
	Name            string
	Description     string
	Version         string
	IsForceDelivery bool
	Entry           string

	// Below fields populated by the *Scoped variants used by the three-tier
	// pickers. Old call sites that use the legacy listing methods see
	// zero values for these; callers that consume the new fields should
	// switch to ListSkillsForListingScoped / ListPluginsForListingScoped.
	Tags       []string
	Categories []string
	Enabled    bool
	ScopeType  string // "global" | "team" | "user"
	ScopeID    string
	// Groups is only populated when the skill is scope=team and the listing
	// caller wants picker UI to show "shared with which team_group". plugin
	// listing leaves it empty (plugins have no team-admin upload UX).
	Groups []ResourceGroupRef
}

// ResourceGroupRef is the minimal projection of team_groups exposed to the
// public skill picker so the UI can render the "shared with which group"
// chip without leaking the full team_group schema.
type ResourceGroupRef struct {
	ID   uuid.UUID
	Name string
}

// ScopeFilter constrains a listing or dispatch query to a subset of the
// three scope tiers. Used by the *Scoped Repo methods.
//
// Semantic: rows whose scope_type is "global" are included when
// IncludeGlobal is true; rows whose scope is "team" are included when
// TeamID != nil and matches; same for user. Multiple flags may be set —
// the result is the union, with name-based override (user > team > global)
// applied by the call sites that need overrides (Listing / dispatch).
type ScopeFilter struct {
	IncludeGlobal bool
	TeamID        *uuid.UUID
	UserID        *uuid.UUID
}

// GlobalOnlyScope is the default scope for back-compat call sites that
// haven't migrated to ScopeFilter yet. Matches the historical "global only"
// behavior of the unsuffixed Repo methods.
func GlobalOnlyScope() ScopeFilter {
	return ScopeFilter{IncludeGlobal: true}
}

// SkillSelection bundles a ScopeFilter with the user-picked skill IDs for
// the dispatch path. ListActiveSkillsScoped takes this so the same struct
// flows from the task usecase down to the SQL.
type SkillSelection struct {
	Scope           ScopeFilter
	UserSelectedIDs []uuid.UUID
}

// MaterializedRule is a fully fetched rule body, ready to be embedded into
// the getCodingConfigs response.
type MaterializedRule struct {
	Name    string
	Content string
}

// MaterializedFile is one entry inside an unzipped skill or plugin asset.
// RelPath is the path inside the archive (e.g. "skill.md", "scripts/run.sh").
type MaterializedFile struct {
	RelPath string
	Content []byte
}

// MaterializedAsset is a skill or plugin after S3 fetch + in-memory unzip.
// Entry is only populated for plugins (it is taken from parsed_meta.entry).
type MaterializedAsset struct {
	Name  string
	Entry string
	Files []MaterializedFile
}

// SkillRef is a skill addressed by a presigned GET URL — the resolver no
// longer downloads + unzips the skill itself; the codingmatrix agent does
// that inside the task VM. This is the replacement for MaterializedAsset on
// the skill dispatch path and exists to keep the gRPC PushTasks payload
// under the 4MiB ceiling regardless of how many skills are in scope.
type SkillRef struct {
	Name    string
	Version string
	ZipURL  string // presigned GET URL (TTL bound by the resolver)
}

// PluginRef is the plugin counterpart of SkillRef. EntryFilename comes from
// parsed_meta.entry and is needed by mcai-backend to write the
// opencode.json `plugin` array — the agent itself does not consume it.
type PluginRef struct {
	Name          string
	Version       string
	ZipURL        string
	EntryFilename string
}
