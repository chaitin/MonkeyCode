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
	s.CRUD = resource.NewCRUD(store, resource.Definition{Kind: "expert", Repository: func(q resource.Queryer) resource.Repository { return sqlc.New(q) }, Path: "/experts", Fields: []string{"name", "description", "prompt", "enabled"}, UserFields: []string{"name", "description", "prompt", "rule_ids", "skill_ids", "connectors"}, Validate: s.validate, Persist: s.links, Decorate: s.decorate})
	return s
}
func (s *Service) validate(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	if _, exists := in["providers"]; exists {
		return resource.Invalid("专家依赖请使用 connectors")
	}
	if raw, exists := in["connectors"]; exists {
		b, err := json.Marshal(raw)
		var links []struct {
			ConnectorID string   `json:"connector_id"`
			Required    *bool    `json:"required"`
			Allow       []string `json:"tool_allowlist"`
			Deny        []string `json:"tool_denylist"`
		}
		if err != nil || string(b) == "null" || json.Unmarshal(b, &links) != nil {
			return resource.Invalid("连接依赖格式无效")
		}
		for _, link := range links {
			if link.ConnectorID == "" {
				return resource.Invalid("连接依赖必须包含 connector_id")
			}
		}
	}
	personal := in.String("ownership_type") == "user"
	if personal {
		for _, key := range []string{"description", "prompt"} {
			if _, ok := in[key]; !ok {
				in[key] = old.String(key)
			}
		}
	}
	if strings.TrimSpace(in.String("prompt")) == "" {
		return resource.Invalid("专家 Prompt 不能为空")
	}
	queries := sqlc.New(tx)
	for _, link := range []struct {
		key, kind string
		lock      func(context.Context, string) ([]byte, error)
	}{{"rule_ids", "rule", queries.LockRule}, {"skill_ids", "skill", queries.LockSkill}, {"connectors", "connector", queries.LockConnector}} {
		ids := resource.Strings(in[link.key])
		if link.kind == "connector" {
			ids = nil
			for _, p := range connectorLinks(in[link.key]) {
				ids = append(ids, p.String("connector_id"))
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
				ok, err = resource.Accessible(ctx, tx, link.kind, o, in.String("actor_id"))
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

func (s *Service) RegisterAgent(r chi.Router) {
	s.CRUD.RegisterAgent(r)
}

func connectorLinks(v any) []resource.Object {
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
	if _, ok := in["connectors"]; ok {
		if _, err := sqlc.New(tx).DeleteConnectorLinks(ctx, in.String("id")); err != nil {
			return err
		}
		for _, p := range connectorLinks(in["connectors"]) {
			required := true
			if v, ok := p["required"].(bool); ok {
				required = v
			}
			if _, err := sqlc.New(tx).CreateConnectorLink(ctx, sqlc.CreateConnectorLinkParams{
				ExpertID:      in.String("id"),
				ConnectorID:   p.String("connector_id"),
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
	p, err := resource.DecodeObjects(sqlc.New(q).ListConnectorLinks(ctx, o.String("id")))
	o["connectors"] = p
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
