package expert

import (
	"context"
	"encoding/json"
	"errors"
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
	s.CRUD = resource.NewCRUD(store, resource.Definition{Kind: "expert", Repository: func(q resource.Queryer) resource.Repository { return sqlc.New(q) }, Path: "/experts", Fields: []string{"name", "description", "prompt", "default_model_id", "enabled"}, UserFields: []string{"name", "description", "prompt", "default_model_id", "rule_ids", "skill_ids", "providers"}, Validate: s.validate, Persist: s.links, Decorate: s.decorate})
	return s
}
func (s *Service) validate(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	personal := in.String("ownership_type") == "user"
	if personal {
		for _, key := range []string{"description", "prompt", "default_model_id"} {
			if _, ok := in[key]; !ok {
				in[key] = old.String(key)
			}
		}
	}
	if strings.TrimSpace(in.String("prompt")) == "" {
		return resource.Invalid("专家 Prompt 不能为空")
	}
	queries := sqlc.New(tx)
	if in.String("default_model_id") == "" {
		in["default_model_id"] = nil
	} else if personal {
		model, err := resource.DecodeObject(queries.GetModel(ctx, in.String("default_model_id")))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return resource.Invalid("默认模型不存在或不可用")
			}
			return err
		}
		ok, err := resource.Accessible(ctx, tx, "model", model, in.String("actor_id"))
		if err != nil {
			return err
		}
		if !ok && model.String("ownership_type") == "system" && model.Bool("enabled") {
			ok, err = resource.CanUseSystem(ctx, tx, in.String("actor_id"))
			if err != nil {
				return err
			}
			if ok {
				ok, err = queries.IsAdmin(ctx, in.String("actor_id"))
				if err != nil {
					return err
				}
			}
		}
		if !ok {
			return resource.Invalid("默认模型不存在或不可用")
		}
	} else {
		ok, err := queries.ModelAvailable(ctx, in.String("default_model_id"))
		if err != nil {
			return err
		}
		if !ok {
			return resource.Invalid("默认模型不存在或不可用")
		}
	}
	for _, link := range []struct {
		key, kind string
		lock      func(context.Context, string) ([]byte, error)
	}{{"rule_ids", "rule", queries.LockRule}, {"skill_ids", "skill", queries.LockSkill}, {"providers", "provider", queries.LockProvider}} {
		ids := resource.Strings(in[link.key])
		if link.kind == "provider" {
			ids = nil
			for _, p := range providerLinks(in[link.key]) {
				ids = append(ids, p.String("provider_id"))
			}
		}
		seen := map[string]bool{}
		for _, id := range ids {
			if seen[id] {
				return resource.Invalid("专家关联重复")
			}
			seen[id] = true
			o, err := resource.DecodeObject(link.lock(ctx, id))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return resource.Invalid("专家关联资源不存在或不可用")
				}
				return err
			}
			ok := o.String("ownership_type") == "system"
			if personal {
				if link.kind == "provider" {
					ok, err = s.providerAvailable(ctx, tx, o, in.String("actor_id"))
				} else {
					ok, err = resource.Accessible(ctx, tx, link.kind, o, in.String("actor_id"))
				}
				if err != nil {
					return err
				}
			}
			if !ok {
				return resource.Invalid("专家关联资源不存在或不可用")
			}
		}
	}
	return nil
}

func (s *Service) providerAvailable(ctx context.Context, tx pgx.Tx, provider resource.Object, actor string) (bool, error) {
	if !provider.Bool("enabled") {
		return false, nil
	}
	if provider.String("ownership_type") == "system" {
		ok, err := resource.CanUseSystem(ctx, tx, actor)
		if err != nil || ok {
			return ok, err
		}
	}
	if provider.String("owner_user_id") == actor {
		return true, nil
	}
	connectors, err := resource.DecodeObjects(sqlc.New(tx).ListProviderConnectors(ctx, provider.String("id")))
	if err != nil {
		return false, err
	}
	for _, connector := range connectors {
		ok, err := resource.Accessible(ctx, tx, "connector", connector, actor)
		if err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

func (s *Service) RegisterAgent(r chi.Router) {
	s.CRUD.RegisterAgent(r)
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
		if o.String("ownership_type") == "user" {
			resource.Fail(w, resource.Invalid("个人资源仅允许治理删除"))
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
