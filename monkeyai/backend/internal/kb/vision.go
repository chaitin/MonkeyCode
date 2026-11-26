package kb

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type ImageDescriber interface {
	ImageModels(context.Context, string) ([]resource.Object, error)
	DescribeImage(context.Context, string, string, string, []byte) (string, error)
}

func (s *Service) WithImageDescriber(v ImageDescriber) *Service { s.vision = v; return s }
func imageFileType(t string) bool                               { return t == "jpg" || t == "png" }

func (s *Service) serveImageModels(w http.ResponseWriter, r *http.Request, admin bool) {
	actor, ok := identity.UserFromContext(r.Context())
	if !ok {
		resource.Fail(r.Context(), w, resource.NotFound)
		return
	}
	if err := s.importAccess(r.Context(), importContext{Actor: actor.ID, KB: chi.URLParam(r, "id"), Admin: admin}); err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	if s.vision == nil {
		resource.Fail(r.Context(), w, resource.Invalid("图片解析模型未配置"))
		return
	}
	items, err := s.vision.ImageModels(r.Context(), actor.ID)
	if err != nil {
		resource.Fail(r.Context(), w, err)
		return
	}
	resource.JSON(r.Context(), w, 200, resource.Object{"items": items})
}

func (s *Service) parseImageImport(ctx context.Context, c importContext, modelID string) (resource.Object, error) {
	return s.processImageImport(ctx, c, modelID, false)
}

// Keep the import lock through persistence for the unified import flow.
func (s *Service) processImageImport(ctx context.Context, c importContext, modelID string, save bool) (resource.Object, error) {
	if !imageFileType(c.Type) || strings.TrimSpace(modelID) == "" {
		return nil, resource.Invalid("图片解析需要 JPG/PNG 原件和 model_id")
	}
	if s.vision == nil {
		return nil, resource.Invalid("图片解析模型未配置")
	}
	// Bound the entire operation, including lock acquisition and permission checks.
	ctx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()
	release, err := acquireImportSlot(ctx, imageSubmissions)
	if err != nil {
		return nil, err
	}
	defer release()
	// The advisory lock must not occupy the business pool: authorization, model
	// resolution and billing need that pool even when it has only one connection.
	if _, loaded := s.imageImports.LoadOrStore(c.ID, true); loaded {
		return nil, resource.Invalid("图片正在解析，请勿重复提交")
	}
	defer s.imageImports.Delete(c.ID)
	conn, err := pgx.ConnectConfig(ctx, s.store.Pool.Config().ConnConfig.Copy())
	if err != nil {
		return nil, err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = conn.Close(cleanup) // Closing also releases the transaction advisory lock.
	}()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	locked, err := sqlc.New(tx).KbLockImageImport(ctx, "kb-image:"+c.ID)
	if err != nil {
		return nil, err
	}
	if !locked {
		return nil, resource.Invalid("图片正在解析，请勿重复提交")
	}
	if err = s.importAccess(ctx, c); err != nil {
		return nil, err
	}
	if existing, err := s.mcpImportExisting(ctx, c); err != nil || existing != nil {
		if err != nil {
			return nil, err
		}
		if save {
			return existing, nil
		}
		return resource.Object{"exists": true, "document_id": existing.String("document_id")}, nil
	}
	storage, ok := s.storage.(ImportStorage)
	if !ok {
		return nil, resource.NotFound
	}
	f, err := storage.Get(ctx, c.Key)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, importFileLimit+1))
	if err != nil {
		return nil, err
	}
	typ, kind, err := importType(c.Name, data)
	if err != nil {
		return nil, err
	}
	if typ != c.Type || kind != c.MIME {
		return nil, resource.Invalid("图片原件与导入凭证不匹配")
	}
	content, err := s.vision.DescribeImage(ctx, c.Actor, modelID, kind, data)
	if err != nil {
		return nil, err
	}
	content, err = validateImportText([]byte(content))
	if err != nil {
		return nil, err
	}
	if err = s.validateConvertedAssets(ctx, c.KB, content); err != nil {
		return nil, err
	}
	if err = s.importAccess(ctx, c); err != nil {
		return nil, err
	}
	c.Purpose, c.ModelID, c.Hash = "result", modelID, convertedHash(content)
	token, err := s.signImport(c)
	if err != nil {
		return nil, err
	}
	if save {
		return s.saveMCPImport(ctx, c, content, token)
	}
	return resource.Object{"content": content, "result_context": token}, nil
}

const mcpDocumentImageLimit = 8 << 20

func originalImageMetadata(doc resource.Object, admin bool) resource.Object {
	prefix := "/api/v1/kb/"
	if admin {
		prefix = "/api/admin/v1/kb/"
	}
	path := prefix + doc.String("kb_id") + "/documents/" + doc.String("id") + "/file/detail"
	return resource.Object{"kb_id": doc.String("kb_id"), "document_id": doc.String("id"), "file_type": doc.String("file_type"), "mime_type": map[string]string{"jpg": "image/jpeg", "png": "image/png"}[doc.String("file_type")], "preview_url": path + "?preview=true", "download_url": path, "read_tool": "kb_get_document_image"}
}

func (s *Service) readMCPDocumentImage(ctx context.Context, actor string, args map[string]any) (resource.Object, error) {
	var in struct {
		KB       string `json:"kb_id"`
		Document string `json:"document_id"`
	}
	if err := decodeMCPArguments(args, &in); err != nil {
		return nil, err
	}
	if _, err := s.GetAccessible(ctx, in.KB, actor); err != nil {
		return nil, err
	}
	doc, err := s.GetAccessibleDocumentInKB(ctx, actor, in.KB, in.Document)
	if err != nil {
		return nil, err
	}
	if !imageFileType(doc.String("file_type")) || doc.String("storage_key") == "" || s.storage == nil {
		return nil, resource.NotFound
	}
	f, err := s.storage.Get(ctx, doc.String("storage_key"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, mcpDocumentImageLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > mcpDocumentImageLimit {
		return nil, resource.Invalid("图片超过 MCP 原图内联上限 8 MiB，请通过已登录网页预览或下载原件")
	}
	_, kind, err := readContentImage(data)
	if err != nil {
		return nil, err
	}
	if kind != map[string]string{"jpg": "image/jpeg", "png": "image/png"}[doc.String("file_type")] {
		return nil, resource.Invalid("原图格式无效")
	}
	if _, err = s.GetAccessible(ctx, in.KB, actor); err != nil {
		return nil, err
	}
	if _, err = s.GetAccessibleDocumentInKB(ctx, actor, in.KB, in.Document); err != nil {
		return nil, err
	}
	meta := originalImageMetadata(doc, false)
	meta["size_bytes"] = len(data)
	encoded, err := json.Marshal(meta)
	if err != nil {
		return nil, err
	}
	return resource.Object{"structuredContent": meta, "content": []any{resource.Object{"type": "text", "text": string(encoded)}, resource.Object{"type": "image", "mimeType": kind, "data": base64.StdEncoding.EncodeToString(data)}}}, nil
}
