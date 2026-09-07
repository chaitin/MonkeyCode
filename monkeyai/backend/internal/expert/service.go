package expert

import (
	"context"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

type Service struct {
	CRUD  *resource.CRUD
	Store *resource.Store
}

func NewService(store *resource.Store) *Service {
	s := &Service{Store: store}
	s.CRUD = resource.NewCRUD(store, resource.Definition{Kind: "expert", Table: "experts", Path: "/experts", Fields: []string{"name", "description", "prompt", "default_model_id", "enabled"}, Validate: s.validate, Persist: s.links, Decorate: s.decorate})
	return s
}
func (s *Service) validate(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	if strings.TrimSpace(in.String("prompt")) == "" {
		return resource.Invalid("专家 Prompt 不能为空")
	}
	if in.String("default_model_id") == "" {
		in["default_model_id"] = nil
	} else {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM models WHERE id=$1 AND ownership_type='system' AND deleted_at IS NULL AND enabled)`, in.String("default_model_id")).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return resource.Invalid("默认模型不存在或不可用")
		}
	}
	for _, link := range []struct{ key, table string }{{"rule_ids", "rules"}, {"skill_ids", "skills"}} {
		seen := map[string]bool{}
		for _, id := range resource.Strings(in[link.key]) {
			if seen[id] {
				return resource.Invalid("专家关联重复")
			}
			seen[id] = true
			_, err := resource.Row(ctx, tx, `SELECT to_jsonb(t) FROM `+link.table+` t WHERE id=$1 AND ownership_type='system' AND deleted_at IS NULL FOR SHARE`, id)
			if err != nil {
				return resource.Invalid("专家只能关联有效系统资源")
			}
		}
	}
	b := providerLinks(in["providers"])
	seen := map[string]bool{}
	for _, p := range b {
		if seen[p.String("provider_id")] {
			return resource.Invalid("Provider 关联重复")
		}
		seen[p.String("provider_id")] = true
		_, err := resource.Row(ctx, tx, `SELECT to_jsonb(p) FROM connector_providers p WHERE id=$1 AND ownership_type='system' AND deleted_at IS NULL FOR SHARE`, p.String("provider_id"))
		if err != nil {
			return resource.Invalid("专家 Provider 不存在")
		}
	}
	return nil
}
func providerLinks(v any) []resource.Object {
	b, _ := json.Marshal(v)
	out := []resource.Object{}
	_ = json.Unmarshal(b, &out)
	return out
}

func (s *Service) links(ctx context.Context, tx pgx.Tx, in resource.Object) error {
	for _, link := range []struct{ key, table, column string }{{"rule_ids", "expert_rules", "rule_id"}, {"skill_ids", "expert_skills", "skill_id"}} {
		if _, ok := in[link.key]; !ok {
			continue
		}
		if _, err := tx.Exec(ctx, `DELETE FROM `+link.table+` WHERE expert_id=$1`, in.String("id")); err != nil {
			return err
		}
		for _, id := range resource.Strings(in[link.key]) {
			if _, err := tx.Exec(ctx, `INSERT INTO `+link.table+`(expert_id,`+link.column+`) VALUES($1,$2)`, in.String("id"), id); err != nil {
				return err
			}
		}
	}
	if _, ok := in["providers"]; ok {
		if _, err := tx.Exec(ctx, `DELETE FROM expert_connector_providers WHERE expert_id=$1`, in.String("id")); err != nil {
			return err
		}
		for _, p := range providerLinks(in["providers"]) {
			required := true
			if v, ok := p["required"].(bool); ok {
				required = v
			}
			if _, err := tx.Exec(ctx, `INSERT INTO expert_connector_providers(expert_id,provider_id,required,tool_allowlist,tool_denylist) VALUES($1,$2,$3,$4,$5)`, in.String("id"), p.String("provider_id"), required, resource.Strings(p["tool_allowlist"]), resource.Strings(p["tool_denylist"])); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Service) decorate(ctx context.Context, q resource.Queryer, o resource.Object) error {
	for _, link := range []struct{ key, table, column string }{{"rule_ids", "expert_rules", "rule_id"}, {"skill_ids", "expert_skills", "skill_id"}} {
		var ids []string
		if err := q.QueryRow(ctx, `SELECT COALESCE(array_agg(`+link.column+`::text ORDER BY `+link.column+`),'{}') FROM `+link.table+` WHERE expert_id=$1`, o.String("id")).Scan(&ids); err != nil {
			return err
		}
		o[link.key] = ids
	}
	p, err := resource.Rows(ctx, q, `SELECT to_jsonb(x) FROM expert_connector_providers x WHERE expert_id=$1 ORDER BY provider_id`, o.String("id"))
	o["providers"] = p
	return err
}
func (s *Service) RegisterAdmin(r chi.Router) {
	s.CRUD.Register(r)
	r.Post("/experts/{id}/copy", func(w http.ResponseWriter, r *http.Request) {
		o, err := s.CRUD.Get(r.Context(), s.Store.Pool, chi.URLParam(r, "id"))
		if err != nil {
			resource.Fail(w, err)
			return
		}
		var in resource.Object
		if err = resource.Decode(w, r, &in); err != nil {
			resource.Fail(w, err)
			return
		}
		o["name"] = in.String("name")
		o["enabled"] = false
		o["grants"] = []any{}
		u, _ := identity.UserFromContext(r.Context())
		out, err := s.CRUD.Save(r.Context(), u.ID, "", "", o)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, 200, out)
	})
}
