package kb

import (
	"context"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

// Original document assets use document IDs; embedded images keep their content hashes.
var originalAssetName = regexp.MustCompile(`^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.(txt|md|html|svg|csv|docx|xls|xlsx|pptx|pdf|jpg|png|bin)$`)

// ServeAsset requires an authenticated browser or agent identity supplied by the caller.
func (s *Service) ServeAsset(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, ok := identity.UserFromContext(ctx)
	id, name := chi.URLParam(r, "id"), chi.URLParam(r, "name")
	original := originalAssetName.FindStringSubmatch(name)
	if !ok || (!assetName.MatchString(name) && original == nil) || s.storage == nil {
		resource.Fail(ctx, w, resource.NotFound)
		return
	}
	book, err := resource.DecodeObject(sqlc.New(s.store.Pool).GetKbResource(ctx, id))
	if err != nil {
		resource.Fail(ctx, w, err)
		return
	}
	// OAuth identities retain client permissions, including for administrators.
	// Only administrator browser sessions may use management read access.
	_, agent := identity.PrincipalFromContext(ctx)
	if user.Role != "admin" || agent {
		permission, e := resolvePermissions(ctx, s.store.Pool, book, user.ID)
		if e != nil {
			resource.Fail(ctx, w, e)
			return
		}
		if !book.Bool("enabled") || !permission.CanRead {
			resource.Fail(ctx, w, resource.NotFound)
			return
		}
	}
	if original != nil {
		doc, err := s.documentInKB(ctx, id, original[1])
		if err != nil {
			resource.Fail(ctx, w, err)
			return
		}
		if original[2] != originalDocumentExtension(doc) || doc.String("node_type") == "folder" {
			resource.Fail(ctx, w, resource.NotFound)
			return
		}
		s.writeOriginal(w, r, doc, true)
		return
	}
	data, mime, err := s.readAsset(ctx, id, name)
	if err != nil {
		resource.Fail(ctx, w, err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Recheck authorization for every request, including after a grant is revoked.
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = w.Write(data)
}

func (s *Service) readAsset(ctx context.Context, id, name string) ([]byte, string, error) {
	if !assetName.MatchString(name) || s.storage == nil {
		return nil, "", resource.NotFound
	}
	body, err := s.storage.Get(ctx, assetObjectKey(id, name))
	if err != nil {
		return nil, "", resource.NotFound
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, (32<<20)+1))
	if err != nil {
		return nil, "", err
	}
	mime := assetMIME(data)
	if len(data) > 32<<20 || mime == "" || !strings.HasPrefix(name, strings.TrimPrefix(imageHash(data), "sha256:")+".") {
		return nil, "", &resource.Error{Status: 502, Code: "storage_corrupted", Message: "知识库图片读取失败"}
	}
	return data, mime, nil
}
