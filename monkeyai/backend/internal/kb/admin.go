package kb

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) RegisterAdmin(r chi.Router) {
	s.CRUD.Register(r)

	// Personal knowledge bases remain read-only through every admin write route.
	r = r.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet && r.Method != http.MethodHead && chi.URLParam(r, "id") != "" {
				item, err := s.Get(r.Context(), chi.URLParam(r, "id"))
				if err == nil && item.String("ownership_type") != "system" {
					err = resource.Invalid("个人知识库在管理端仅支持读取")
				}
				if err != nil {
					resource.Fail(r.Context(), w, err)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Get("/kb/{id}/documents", func(w http.ResponseWriter, r *http.Request) {
		kbID := strings.TrimSpace(chi.URLParam(r, "id"))
		if _, err := s.Get(r.Context(), kbID); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		items, err := s.ListDocuments(r.Context(), kbID)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"items": publicDocumentTree(items)})
	})

	r.Post("/kb/{id}/documents/batch", func(w http.ResponseWriter, r *http.Request) {
		kbID := strings.TrimSpace(chi.URLParam(r, "id"))
		var input BatchDocumentInput
		if err := resource.Decode(w, r, &input); err != nil {
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
		kbID := strings.TrimSpace(chi.URLParam(r, "id"))
		var input struct {
			MoveDocumentInput
			ID string `json:"id"`
		}
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		if _, err := s.documentInKB(r.Context(), kbID, input.ID); err != nil {
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
		kbID := strings.TrimSpace(chi.URLParam(r, "id"))
		if _, err := s.Get(r.Context(), kbID); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		var input DocumentInput
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		input.KbID = kbID
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.CreateDocument(r.Context(), user.ID, input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusAccepted, item)
	})

	r.Get("/kb/{id}/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		item, err := s.documentInKB(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "documentId"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, item)
	})

	r.Put("/kb/{id}/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.documentInKB(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		var input DocumentInput
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		input.KbID = strings.TrimSpace(chi.URLParam(r, "id"))
		item, err := s.UpdateDocument(r.Context(), chi.URLParam(r, "documentId"), input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusAccepted, item)
	})

	r.Delete("/kb/{id}/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.documentInKB(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		if err := s.DeleteDocument(r.Context(), chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	r.Post("/kb/{id}/documents/restudy", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			IDs []string `json:"ids"`
		}
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		result, err := s.RestudyDocuments(r.Context(), chi.URLParam(r, "id"), input.IDs)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusAccepted, result)
	})

	r.Post("/kb/{id}/documents/{documentId}/restudy", func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.documentInKB(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		item, err := s.RestudyDocument(r.Context(), chi.URLParam(r, "documentId"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusAccepted, item)
	})

	r.Get("/kb/{id}/documents/{documentId}/chunks", func(w http.ResponseWriter, r *http.Request) {
		if _, err := s.documentInKB(r.Context(), chi.URLParam(r, "id"), chi.URLParam(r, "documentId")); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		items, err := s.ListChunks(r.Context(), chi.URLParam(r, "documentId"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"items": items})
	})

	r.Post("/kb/{id}/embedding-model/switch", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ModelID          string          `json:"model_id"`
			EmbeddingModelID json.RawMessage `json:"embedding_model_id"`
		}
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		modelID := input.ModelID
		if input.EmbeddingModelID != nil {
			if strings.TrimSpace(string(input.EmbeddingModelID)) == "null" {
				modelID = ""
			} else if err := json.Unmarshal(input.EmbeddingModelID, &modelID); err != nil {
				resource.Fail(r.Context(), w, resource.Invalid("embedding_model_id 必须为字符串或 null"))
				return
			}
		}
		item, err := s.SwitchEmbeddingModel(r.Context(), chi.URLParam(r, "id"), modelID, r.Header.Get("If-Match"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, item)
	})

	r.Post("/kb/{id}/index/rebuild", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Operation string `json:"operation"`
			ModelID   string `json:"model_id"`
		}
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		item, err := s.RebuildIndex(r.Context(), chi.URLParam(r, "id"), input.Operation, input.ModelID, r.Header.Get("If-Match"))
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusAccepted, item)
	})

	r.Post("/kb/search", func(w http.ResponseWriter, r *http.Request) {
		var input SearchInput
		if err := resource.Decode(w, r, &input); err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		response, err := s.SearchWithResponse(r.Context(), user.ID, input)
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, response)
	})
}

func (s *Service) documentInKB(ctx context.Context, kbID, documentID string) (resource.Object, error) {
	item, err := s.GetDocument(ctx, documentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, resource.NotFound
		}
		return nil, err
	}
	if item.String("kb_id") != kbID {
		return nil, resource.NotFound
	}
	return item, nil
}
