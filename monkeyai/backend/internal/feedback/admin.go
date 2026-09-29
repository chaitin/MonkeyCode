package feedback

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/feedback/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/feedback", s.list)
	router.Get("/feedback/{id}", s.detail)
	router.Get("/feedback/{id}/attachments/{attachmentID}", s.download)
	router.Patch("/feedback/{id}", s.patch)
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	page, size, err := resource.PageParams(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	category, state, err := feedbackFilters(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	q := sqlc.New(s.pool)
	items, err := q.ListFeedbacks(r.Context(), sqlc.ListFeedbacksParams{
		Category: category, State: state, PageLimit: int32(size), PageOffset: int32((page - 1) * size),
	})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	total, err := q.CountFeedbacks(r.Context(), sqlc.CountFeedbacksParams{Category: category, State: state})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out := make([]Feedback, 0, len(items))
	for _, item := range items {
		out = append(out, summary(item))
	}
	resource.JSON(w, http.StatusOK, map[string]any{"items": out, "total": total, "page": page, "page_size": size})
}

func feedbackFilters(r *http.Request) (string, string, error) {
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	if category != "" && !slices.Contains(categories, category) {
		return "", "", resource.Invalid("category 无效")
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state != "" && !slices.Contains(states, state) {
		return "", "", resource.Invalid("state 无效")
	}
	return category, state, nil
}

func (s *Service) detail(w http.ResponseWriter, r *http.Request) {
	row, err := sqlc.New(s.pool).FeedbackByID(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		resource.Fail(w, resource.NotFound)
		return
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out, err := s.read(r.Context(), row)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, out)
}

func (s *Service) patch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		State string `json:"state"`
	}
	if err := resource.Decode(w, r, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	if !slices.Contains(patchStates, in.State) {
		resource.Fail(w, resource.Invalid("反馈状态无效"))
		return
	}
	row, err := sqlc.New(s.pool).UpdateFeedbackState(r.Context(), sqlc.UpdateFeedbackStateParams{ID: chi.URLParam(r, "id"), State: in.State})
	if errors.Is(err, pgx.ErrNoRows) {
		resource.Fail(w, resource.NotFound)
		return
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	out, err := s.read(r.Context(), row)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, out)
}

func (s *Service) download(w http.ResponseWriter, r *http.Request) {
	row, err := sqlc.New(s.pool).AttachmentForDownload(r.Context(), sqlc.AttachmentForDownloadParams{
		FeedbackID: chi.URLParam(r, "id"), AttachmentID: chi.URLParam(r, "attachmentID"),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		resource.Fail(w, resource.NotFound)
		return
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	body, err := s.storage.Get(r.Context(), row.ObjectKey)
	if err != nil {
		resource.Fail(w, storageFailure())
		return
	}
	defer func() {
		if closeErr := body.Close(); closeErr != nil && r.Context().Err() == nil {
			slog.WarnContext(r.Context(), "关闭反馈附件读取流失败", "feedback_id", row.FeedbackID, "attachment_id", row.ID, "error_type", errorType(closeErr))
		}
	}()
	w.Header().Set("Content-Type", row.MimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(row.ByteSize, 10))
	w.Header().Set("Content-Disposition", "inline; filename=feedback-attachment."+extension(row.MimeType))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("ETag", `"`+row.Sha256+`"`)
	if _, err := io.Copy(w, body); err != nil {
		slog.WarnContext(r.Context(), "传输反馈附件失败", "feedback_id", row.FeedbackID, "attachment_id", row.ID, "error_type", errorType(err))
	}
}

func summary(row sqlc.Feedback) Feedback {
	return Feedback{
		ID: row.ID, UserID: row.UserID, Category: row.Category, Content: row.Content, Rating: row.Rating,
		Platform: row.Platform, ClientVersion: row.ClientVersion, State: row.State, RequestID: row.RequestID,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, Attachments: []Attachment{},
	}
}

func extension(mime string) string {
	switch mime {
	case "image/jpeg":
		return "jpeg"
	case "image/webp":
		return "webp"
	default:
		return "png"
	}
}
