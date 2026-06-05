package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/ent/types"
)

// AgentSyncJob holds the schema definition for the agent_sync_jobs entity.
//
// sync_jobs references rule / repo via plain UUID columns (no ent edge),
// because resource_kind decides whether rule_id or repo_id is populated.
type AgentSyncJob struct {
	ent.Schema
}

func (AgentSyncJob) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_sync_jobs"),
	}
}

// Fields of the AgentSyncJob.
func (AgentSyncJob) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.Enum("resource_kind").Values("rule", "skill", "plugin"),
		field.UUID("rule_id", uuid.UUID{}).Optional().Nillable(),
		field.UUID("repo_id", uuid.UUID{}).Optional().Nillable(),
		field.Enum("source_type").Values("github", "upload", "npm", "rule_inline"),
		field.Enum("status").
			Values("pending", "fetching", "parsing", "uploading", "done", "failed").
			Default("pending"),
		field.Enum("trigger_type").Values("manual", "upload", "rule_save"),
		field.UUID("triggered_by", uuid.UUID{}).Optional().Nillable(),
		field.Time("started_at").Optional().Nillable(),
		field.Time("finished_at").Optional().Nillable(),
		field.JSON("errors", types.SyncJobErrors{}).Optional(),
		field.JSON("result_summary", types.SyncJobResultSummary{}).Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Indexes of the AgentSyncJob.
func (AgentSyncJob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("status", "created_at"),
		index.Fields("rule_id"),
		index.Fields("repo_id"),
	}
}
