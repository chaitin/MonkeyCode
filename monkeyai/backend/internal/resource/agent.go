package resource

import (
	"context"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func owned(o Object, actor string) bool {
	return actor != "" && o.String("ownership_type") == "user" && o.String("owner_user_id") == actor
}

func (c *CRUD) GetUser(ctx context.Context, q Queryer, id, actor string) (Object, error) {
	o, err := DecodeObject(c.Def.Repository(q).GetResource(ctx, id))
	if err != nil {
		return nil, err
	}
	if !owned(o, actor) {
		return nil, NotFound
	}
	o, err = c.decorate(ctx, q, o)
	if err != nil {
		return nil, err
	}
	if c.Def.UserDecorate != nil {
		c.Def.UserDecorate(o)
	}
	return o, nil
}

func (c *CRUD) SaveUser(ctx context.Context, actor, id, match string, in Object) (Object, error) {
	if actor == "" || len(c.Def.UserFields) == 0 {
		return nil, NotFound
	}
	input := Object{}
	for _, key := range c.Def.UserFields {
		if value, ok := in[key]; ok {
			input[key] = value
		}
	}
	return c.save(ctx, actor, id, match, input, true)
}

func (c *CRUD) DeleteUser(ctx context.Context, actor, id, match string) error {
	return c.delete(ctx, actor, id, match, true)
}

func (c *CRUD) LockOwned(ctx context.Context, tx pgx.Tx, id, actor string) error {
	o, err := DecodeObject(c.Def.Repository(tx).LockResource(ctx, id))
	if err != nil {
		return err
	}
	if !owned(o, actor) {
		return NotFound
	}
	return nil
}

func (c *CRUD) TouchShared(ctx context.Context, tx pgx.Tx, id string) error {
	return c.Def.Repository(tx).TouchResource(ctx, id)
}

func (c *CRUD) RegisterAgent(router chi.Router) {
	path := c.Def.Path
	router.Get(path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		item, err := c.GetUser(r.Context(), c.Store.Pool, chi.URLParam(r, "id"), user.ID)
		if err != nil {
			Fail(w, err)
			return
		}
		ETag(w, item)
		JSON(w, http.StatusOK, item)
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		var input Object
		if err := Decode(w, r, &input); err != nil {
			Fail(w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		item, err := c.SaveUser(r.Context(), user.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), input)
		if err != nil {
			Fail(w, err)
			return
		}
		status := http.StatusOK
		if r.Method == http.MethodPost {
			status = http.StatusCreated
		}
		ETag(w, item)
		JSON(w, status, item)
	}
	router.Post(path, save)
	router.Put(path+"/{id}", save)
	router.Delete(path+"/{id}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		if err := c.DeleteUser(r.Context(), user.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match")); err != nil {
			Fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
