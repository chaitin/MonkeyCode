package expert

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	CRUD  *resource.CRUD
	Store *resource.Store
}

func NewService(store *resource.Store) *Service {
	s := &Service{Store: store}
	s.CRUD = resource.NewCRUD(store, resource.Definition{Kind: "expert", Repository: func(q resource.Queryer) resource.Repository { return sqlc.New(q) }, Path: "/experts", Fields: []string{"name", "description", "prompt", "default_model_id", "enabled"}, Validate: s.validate, Persist: s.links, Decorate: s.decorate})
	return s
}
func (s *Service) validate(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	if strings.TrimSpace(in.String("prompt")) == "" {
		return resource.Invalid("专家 Prompt 不能为空")
	}
	if in.String("default_model_id") == "" {
		in["default_model_id"] = nil
	} else {
		ok, err := sqlc.New(tx).ModelAvailable(ctx, in.String("default_model_id"))
		if err != nil {
			return err
		}

		if !ok {
			return resource.Invalid("默认模型不存在或不可用")
		}
	}
	queries := sqlc.New(tx)
	for _, link := range []struct {
		key  string
		lock func(context.Context, string) (string, error)
	}{{"rule_ids", queries.LockRule}, {"skill_ids", queries.LockSkill}} {
		seen := map[string]bool{}
		for _, id := range resource.Strings(in[link.key]) {
			if seen[id] {
				return resource.Invalid("专家关联重复")
			}
			seen[id] = true
			_, err := link.lock(ctx, id)
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
		_, err := resource.DecodeObject(sqlc.New(tx).LockProvider(ctx, p.String("provider_id")))
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
	queries := sqlc.New(tx)
	if raw, ok := in["rule_ids"]; ok {
		if err := queries.DeleteRuleLinks(ctx, in.String("id")); err != nil {
			return err
		}
		for _, id := range resource.Strings(raw) {
			if err := queries.CreateRuleLink(ctx, sqlc.CreateRuleLinkParams{ExpertID: in.String("id"), RuleID: id}); err != nil {
				return err
			}
		}
	}
	if raw, ok := in["skill_ids"]; ok {
		if err := queries.DeleteSkillLinks(ctx, in.String("id")); err != nil {
			return err
		}
		for _, id := range resource.Strings(raw) {
			if err := queries.CreateSkillLink(ctx, sqlc.CreateSkillLinkParams{ExpertID: in.String("id"), SkillID: id}); err != nil {
				return err
			}
		}
	}
	if _, ok := in["providers"]; ok {
		if _, err := sqlc.New(tx).DeleteProviderLinks(ctx, in.String("id")); err != nil {
			return err
		}
		for _, p := range providerLinks(in["providers"]) {
			required := true
			if v, ok := p["required"].(bool); ok {
				required = v
			}
			if _, err := sqlc.New(tx).CreateProviderLink(ctx, sqlc.CreateProviderLinkParams{
				ExpertID:      in.String("id"),
				ProviderID:    p.String("provider_id"),
				Required:      required,
				ToolAllowlist: resource.Strings(p["tool_allowlist"]),
				ToolDenylist:  resource.Strings(p["tool_denylist"]),
			}); err != nil {
				return err
			}
		}
	}
	return nil
}
func (s *Service) decorate(ctx context.Context, q resource.Queryer, o resource.Object) error {
	queries := sqlc.New(q)
	rules, err := queries.ListRuleIDs(ctx, o.String("id"))
	if err != nil {
		return err
	}
	skills, err := queries.ListSkillIDs(ctx, o.String("id"))
	if err != nil {
		return err
	}
	o["rule_ids"], o["skill_ids"] = rules, skills
	p, err := resource.DecodeObjects(sqlc.New(q).ListProviderLinks(ctx, o.String("id")))
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
