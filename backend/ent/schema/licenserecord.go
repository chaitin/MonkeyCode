package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type LicenseRecord struct {
	ent.Schema
}

func (LicenseRecord) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("license_records"),
	}
}

func (LicenseRecord) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.String("license_id").NotEmpty().Unique(),
		field.String("installation_id").NotEmpty(),
		field.String("customer_id").Optional(),
		field.String("customer_name").Optional(),
		field.Int("seats"),
		field.Time("issued_at"),
		field.Time("expires_at"),
		field.String("payload_json"),
		field.String("signature"),
		field.String("key_id"),
		field.Enum("alg").Values("Ed25519"),
		field.Bool("active").Default(false),
		field.Time("imported_at"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
