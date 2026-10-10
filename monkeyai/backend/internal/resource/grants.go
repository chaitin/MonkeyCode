package resource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"
	"github.com/jackc/pgx/v5"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"

	"github.com/go-chi/chi/v5"
)

func checkRetiredGrants(ctx context.Context, tx pgx.Tx, kind, id string, raw any) error {
	value, err := sqlc.New(tx).LockResourceImport(ctx, sqlc.LockResourceImportParams{ResourceType: kind, ResourceID: id})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && value != true {
		return nil
	}
	if err != nil {
		return err
	}
	current, err := Grants(ctx, tx, kind, id)
	if err != nil {
		return err
	}
	allowed := map[string]bool{}
	for _, grant := range current {
		entry := Object{"all_users": grant.Bool("all_users"), "usage_requirement": grant.String("usage_requirement")}
		if user := grant.String("user_id"); user != "" {
			entry["user_id"] = user
		}
		if group := grant.String("group_id"); group != "" {
			entry["group_id"] = group
		}
		allowed[Hash(entry)] = true
	}
	var requested []Object
	data, err := json.Marshal(raw)
	if err != nil || json.Unmarshal(data, &requested) != nil {
		return Invalid("授权格式无效")
	}
	for _, entry := range requested {
		user := entry.String("user_id")
		group := entry.String("group_id")
		if group == rootgroup.ID && user == "" {
			entry["all_users"], group = true, ""
		}
		usage := entry.String("usage_requirement")
		if usage == "" {
			usage = "optional"
		}
		key := Object{"all_users": entry.Bool("all_users"), "usage_requirement": usage}
		if user != "" {
			key["user_id"] = user
		}
		if group != "" {
			key["group_id"] = group
		}
		if !allowed[Hash(key)] {
			return Invalid("退役资源只能撤销现有授权")
		}
	}
	return nil
}

func (s *Store) RegisterGrants(r chi.Router, resources map[string]*CRUD) {
	r.Get("/resources/{type}/{id}/grants", func(w http.ResponseWriter, r *http.Request) {
		c := resources[chi.URLParam(r, "type")]
		if c == nil {
			Fail(w, NotFound)
			return
		}
		o, err := c.Get(r.Context(), s.Pool, chi.URLParam(r, "id"))
		if err != nil {
			Fail(w, err)
			return
		}
		ETag(w, o)
		JSON(w, 200, Object{"grants": o["grants"], "revision": o["revision"]})
	})
	r.Put("/resources/{type}/{id}/grants", func(w http.ResponseWriter, r *http.Request) {
		c := resources[chi.URLParam(r, "type")]
		if c == nil {
			Fail(w, NotFound)
			return
		}
		var in Object
		if err := Decode(w, r, &in); err != nil {
			Fail(w, err)
			return
		}
		ctx := r.Context()
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			Fail(w, err)
			return
		}
		defer func() { rollback(ctx, tx, "update_grants", chi.URLParam(r, "id")) }()
		id := chi.URLParam(r, "id")
		o, err := DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
		if err != nil {
			Fail(w, err)
			return
		}
		if o.String("ownership_type") == "user" {
			Fail(w, Invalid("个人资源不支持在管理端调整授权"))
			return
		}
		if r.Header.Get("If-Match") != fmt.Sprintf(`"%v"`, o["revision"]) {
			Fail(w, Conflict)
			return
		}
		if err = checkRetiredGrants(ctx, tx, c.Def.Kind, id, in["grants"]); err != nil {
			Fail(w, err)
			return
		}
		u, _ := identity.UserFromContext(ctx)
		if err = SaveGrants(ctx, tx, c.Def.Kind, id, u.ID, in["grants"], false); err == nil {
			err = c.Def.Repository(tx).TouchResource(ctx, id)
		}
		if err == nil {
			err = Audit(ctx, tx, u.ID, c.Def.Kind, id, "grants")
		}

		if err == nil {
			err = tx.Commit(ctx)
		}
		if err != nil {
			Fail(w, err)
			return
		}

		o, err = c.Get(ctx, s.Pool, id)
		if err != nil {
			Fail(w, err)
			return
		}
		ETag(w, o)
		JSON(w, 200, Object{"grants": o["grants"], "revision": o["revision"]})
	})
}
