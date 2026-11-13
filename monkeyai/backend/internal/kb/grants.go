package kb

import (
	"fmt"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

// Personal grant management is reserved for the owner, never content editors.
func (s *Service) registerPersonalGrants(r chi.Router) {
	r.Get("/kb/permissions/list", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.ownedUserKB(r.Context(), user.ID, r.URL.Query().Get("kb_id"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.ETag(w, item)
		resource.JSON(r.Context(), w, 200, resource.Object{"grants": item["grants"], "revision": item["revision"]})
	})
	r.Put("/kb/permissions/update", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			KbID   string            `json:"kb_id"`
			Grants []resource.Object `json:"grants"`
		}
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		if input.Grants == nil {
			resource.Fail(r.Context(), w, resource.Invalid("grants 必须为数组，清空授权请传空数组"))
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		tx, err := s.store.Pool.Begin(r.Context())
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		defer rollback(r.Context(), tx, input.KbID)
		item, err := resource.DecodeObject(newRepository(tx).LockResource(r.Context(), input.KbID))
		if err == nil && (item.String("ownership_type") != "user" || item.String("owner_user_id") != user.ID) {
			err = resource.NotFound
		}
		if err == nil && r.Header.Get("If-Match") == "" {
			err = &resource.Error{Status: 428, Code: "precondition_required", Message: "修改授权需要 If-Match"}
		}
		if err == nil && r.Header.Get("If-Match") != fmt.Sprintf(`"%v"`, item["revision"]) {
			err = resource.Conflict
		}
		if err == nil {
			err = resource.SaveKbGrants(r.Context(), tx, input.KbID, user.ID, input.Grants, true)
		}
		if err == nil {
			err = newRepository(tx).TouchResource(r.Context(), input.KbID)
		}
		if err == nil {
			err = resource.Audit(r.Context(), tx, user.ID, "kb", input.KbID, "grants")
		}
		var updated resource.Object
		if err == nil {
			updated, err = s.CRUD.Get(r.Context(), tx, input.KbID)
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.ETag(w, updated)
		resource.JSON(r.Context(), w, 200, resource.Object{"grants": updated["grants"], "revision": updated["revision"]})
	})
}
