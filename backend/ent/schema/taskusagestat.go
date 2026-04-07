package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

// TaskUsageStat holds the schema definition for the TaskUsageStat entity.
type TaskUsageStat struct {
	ent.Schema
}

func (TaskUsageStat) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("task_usage_stats"),
	}
}

// Fields of the TaskUsageStat.
func (TaskUsageStat) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("task_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("model").Default(""),
		field.Int64("input_tokens").Default(0),
		field.Int64("output_tokens").Default(0),
		field.Int64("total_tokens").Default(0),
		field.Time("created_at").Default(time.Now),
	}
}

// Indexes of the TaskUsageStat.
func (TaskUsageStat) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("task_id"),
		index.Fields("user_id"),
	}
}

// Edges of the TaskUsageStat.
func (TaskUsageStat) Edges() []ent.Edge {
	return nil
}
