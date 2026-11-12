package kb

import (
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(r chi.Router) {
	r.Get("/kb", func(w http.ResponseWriter, r *http.Request) {
		page, size, err := resource.PageParams(r)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		filter, err := resource.ParseCatalogFilter(r)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		payload, err := s.listKnowledgeBasePage(r.Context(), user.ID, filter, resource.QueryTagIDs(r), page, size)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		err = httpapi.CachedJSON(w, r, payload)
		if err != nil {
			resource.Fail(r.Context(), w, err)
		}
	})

	r.Get("/kb/tags", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		items, err := s.listAccessible(r.Context(), user.ID, resource.CatalogFilter{})
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		out := make([]resource.Object, 0, len(items))
		for _, item := range items {
			if item.Bool("enabled") {
				out = append(out, publicKB(item))
			}
		}
		err = httpapi.CachedJSON(w, r, map[string]any{"tags": resource.CollectTags(out)})
		if err != nil {
			resource.Fail(r.Context(), w, err)
		}
	})

	r.Post("/kb", func(w http.ResponseWriter, r *http.Request) {
		var input resource.Object
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.CreateUserKB(r.Context(), user.ID, input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		out := publicKBDetail(item, user.ID)
		resource.ETag(w, out)
		resource.JSON(r.Context(), w, http.StatusCreated, out)
	})

	r.Post("/kb/search", func(w http.ResponseWriter, r *http.Request) {
		var input SearchInput
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		response, err := s.SearchLearnedWithResponse(r.Context(), user.ID, input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, response)
	})

	r.Get("/kb/{id}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.GetAccessible(r.Context(), strings.TrimSpace(chi.URLParam(r, "id")), user.ID)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		out := publicKBDetail(item, user.ID)
		resource.ETag(w, out)
		resource.JSON(r.Context(), w, http.StatusOK, out)
	})

	r.Put("/kb/{id}", func(w http.ResponseWriter, r *http.Request) {
		var input resource.Object
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.UpdateUserKB(r.Context(), user.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match"), input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		out := publicKBDetail(item, user.ID)
		resource.ETag(w, out)
		resource.JSON(r.Context(), w, http.StatusOK, out)
	})

	r.Delete("/kb/{id}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		if err := s.DeleteUserKB(r.Context(), user.ID, chi.URLParam(r, "id"), r.Header.Get("If-Match")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	r.Get("/kb/{id}/documents", func(w http.ResponseWriter, r *http.Request) {
		page, size, err := resource.PageParams(r)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		result, err := s.ListAccessibleDocuments(r.Context(), user.ID, chi.URLParam(r, "id"), DocumentListFilter{
			Query:      r.URL.Query().Get("q"),
			Status:     r.URL.Query().Get("status"),
			SourceType: r.URL.Query().Get("source_type"),
			Page:       page,
			PageSize:   size,
		})
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, result)
	})

	r.Post("/kb/{id}/documents/batch", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		var input BatchDocumentInput
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		kbID := strings.TrimSpace(chi.URLParam(r, "id"))
		if _, err := s.ownedUserKB(r.Context(), user.ID, kbID); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		result, err := s.BatchDocuments(r.Context(), kbID, input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, result)
	})

	r.Post("/kb/{id}/documents/move", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		var input struct {
			MoveDocumentInput
			ID string `json:"id"`
		}
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		kbID := strings.TrimSpace(chi.URLParam(r, "id"))
		if _, err := s.GetAccessibleDocumentInKB(r.Context(), user.ID, kbID, input.ID); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		if _, err := s.ownedUserKB(r.Context(), user.ID, kbID); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		item, err := s.MoveDocument(r.Context(), kbID, input.ID, input.MoveDocumentInput)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, publicDocument(item))
	})

	r.Post("/kb/{id}/documents", func(w http.ResponseWriter, r *http.Request) {
		var input DocumentInput
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		input.KbID = strings.TrimSpace(chi.URLParam(r, "id"))
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.CreateUserDocument(r.Context(), user.ID, input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusAccepted, publicDocument(item))
	})

	r.Get("/kb/{id}/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.GetAccessibleDocumentInKB(r.Context(), user.ID, chi.URLParam(r, "id"), chi.URLParam(r, "documentId"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, publicDocument(item))
	})

	r.Put("/kb/{id}/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		if _, err := s.GetAccessibleDocumentInKB(r.Context(), user.ID, chi.URLParam(r, "id"), chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		var input DocumentInput
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		item, err := s.UpdateUserDocument(r.Context(), user.ID, chi.URLParam(r, "documentId"), input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusAccepted, publicDocument(item))
	})

	r.Delete("/kb/{id}/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		if _, err := s.GetAccessibleDocumentInKB(r.Context(), user.ID, chi.URLParam(r, "id"), chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		if err := s.DeleteUserDocument(r.Context(), user.ID, chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
