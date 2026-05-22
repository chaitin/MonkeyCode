package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

type LicenseInstallation struct {
	ent.Schema
}

func (LicenseInstallation) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("license_installations"),
	}
}

func (LicenseInstallation) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.String("installation_id").NotEmpty().Unique(),
		field.Enum("product").Values("monkeycode-enterprise"),
		field.String("product_version").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
