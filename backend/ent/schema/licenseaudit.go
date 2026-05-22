package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type LicenseAudit struct {
	ent.Schema
}

func (LicenseAudit) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("license_audits"),
	}
}

func (LicenseAudit) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.String("license_id").Optional(),
		field.Enum("action").Values("export_machine_code", "import_license", "view_status"),
		field.Enum("result").Values("success", "failed"),
		field.String("message").Optional(),
		field.Time("created_at").Default(time.Now),
	}
}
