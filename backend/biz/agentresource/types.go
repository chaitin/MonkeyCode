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
