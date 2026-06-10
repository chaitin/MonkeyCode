package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

// TeamOIDCConfig holds the schema definition for team OIDC login configuration.
type TeamOIDCConfig struct {
	ent.Schema
}

func (TeamOIDCConfig) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_oidc_configs"),
	}
}

func (TeamOIDCConfig) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("team_id", uuid.UUID{}),
		field.Bool("enabled").Default(false),
		field.String("display_name").Default("企业登录"),
		field.String("issuer").NotEmpty(),
		field.String("client_id").NotEmpty(),
		field.String("client_secret_ciphertext").Optional(),
		field.String("scopes").Default("openid email profile"),
		field.String("email_domain").Optional(),
		field.Bool("auto_create_member").Default(false),
		field.Bool("allow_password_login").Default(true),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (TeamOIDCConfig) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("team", Team.Type).Field("team_id").Unique().Required(),
	}
}

func (TeamOIDCConfig) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("team_id").Unique(),
	}
}
