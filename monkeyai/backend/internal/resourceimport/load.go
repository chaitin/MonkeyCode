package resourceimport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/designcatalog"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport/sqlc"
	"github.com/jackc/pgx/v5"
)

type importInput struct {
	UploadID           string            `json:"upload_id"`
	Options            Options           `json:"options"`
	PackageSHA256      string            `json:"package_sha256"`
	PlanDigest         string            `json:"plan_digest"`
	Sections           []string          `json:"sections,omitempty"`
	DiscoverOnly       bool              `json:"discover_only,omitempty"`
	SectionPlanDigests map[string]string `json:"section_plan_digests,omitempty"`
}

type loadedImport struct {
	input      importInput
	pkg        Package
	items      Resources
	sha        string
	cleanup    func()
	tx         pgx.Tx
	design     *designcatalog.Package
	inspection designcatalog.Inspection
	sections   []string
}

func (s *Service) loadImport(w http.ResponseWriter, r *http.Request) (loaded loadedImport, err error) {
	var reader io.ReaderAt
	var size int64
	var release func()
	loaded.cleanup = func() {}
	defer func() {
		cleanup := loaded.cleanup
		var once sync.Once
		loaded.cleanup = func() {
			once.Do(func() {
				cleanup()
				if release != nil {
					release()
				}
			})
		}
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			loaded.cleanup()
		}
	}()
	if s.importSlots != nil {
		select {
		case s.importSlots <- struct{}{}:
			release = func() { <-s.importSlots }
		case <-r.Context().Done():
			err = r.Context().Err()
			return
		}
	}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		if err = resource.Decode(w, r, &loaded.input); err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			return
		}
		actor, ok := identity.UserFromContext(r.Context())
		if !ok || actor.Role != "admin" {
			err = resource.NotFound
			return
		}
		var upload Upload
		upload, loaded.tx, err = s.lockUpload(r.Context(), loaded.input.UploadID, actor.ID)
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			return
		}
		loaded.cleanup = func() {
			if err := loaded.tx.Rollback(context.WithoutCancel(r.Context())); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
				slog.Error("回滚事务失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			}
		}
		if upload.Status != "ready" && upload.Status != "imported" {
			err = resource.Invalid("请先完成资源包上传和完整性检查")
			return
		}
		var cleanup func()
		reader, loaded.sha, cleanup, err = s.openUpload(r.Context(), upload)
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			return
		}
		loaded.cleanup = func() {
			cleanup()
			if err := loaded.tx.Rollback(context.WithoutCancel(r.Context())); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
				slog.Error("回滚事务失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			}
		}
		size = upload.TotalSize
	} else {
		r.Body = http.MaxBytesReader(w, r.Body, MaxPackage+(16<<20))
		var file multipart.File
		loaded.cleanup = func() {
			if file != nil {
				if err := file.Close(); err != nil {
					slog.Error("关闭资源失败", "module", "resourceimport", "operation", "loadImport", "error", err)
				}
			}
			if r.MultipartForm != nil {
				if err := r.MultipartForm.RemoveAll(); err != nil && !os.IsNotExist(err) {
					slog.Error("清理临时文件失败", "module", "resourceimport", "operation", "loadImport", "error", err)
				}
			}
		}
		if err = r.ParseMultipartForm(8 << 20); err != nil {
			err = resource.Invalid("资源包上传格式或大小无效")
			return
		}
		var header *multipart.FileHeader
		file, header, err = r.FormFile("package")
		if err != nil {
			err = resource.Invalid("缺少资源包文件")
			return
		}
		if header.Size <= 0 || header.Size > MaxPackage {
			err = resource.Invalid("资源包超过大小限制")
			return
		}
		if value := r.FormValue("options"); value != "" {
			if json.Unmarshal([]byte(value), &loaded.input.Options) != nil {
				err = resource.Invalid("导入选项无效")
				return
			}
		}
		loaded.input.PackageSHA256, loaded.input.PlanDigest = r.FormValue("package_sha256"), r.FormValue("plan_digest")
		if value := r.FormValue("sections"); value != "" {
			if json.Unmarshal([]byte(value), &loaded.input.Sections) != nil {
				err = resource.Invalid("导入分区无效")
				return
			}
		}
		if value := r.FormValue("section_plan_digests"); value != "" {
			if json.Unmarshal([]byte(value), &loaded.input.SectionPlanDigests) != nil {
				err = resource.Invalid("分区计划无效")
				return
			}
		}
		loaded.input.DiscoverOnly = r.FormValue("discover_only") == "true"
		hash := sha256.New()
		if _, err = io.Copy(hash, io.NewSectionReader(file, 0, header.Size)); err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			return
		}
		loaded.sha = "sha256:" + hex.EncodeToString(hash.Sum(nil))
		reader, size = file, header.Size
	}
	loaded.inspection, err = designcatalog.Inspect(reader, size)
	if err != nil {
		err = resource.Invalid(err.Error())
		return
	}
	if loaded.input.DiscoverOnly {
		return
	}
	loaded.sections, err = selectSections(loaded.input.Sections, loaded.inspection)
	if err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "resourceimport", "operation", "loadImport", "error", err)
		return
	}
	if containsSection(loaded.sections, "design") {
		if s.design == nil {
			err = &resource.Error{Status: 503, Code: "service_unavailable", Message: "设计资源导入尚未配置"}
			return
		}
		loaded.design, err = designcatalog.Parse(r.Context(), reader, size)
		if err != nil {
			err = resource.Invalid(err.Error())
			return
		}
		previous := loaded.cleanup
		pkg := loaded.design
		loaded.cleanup = func() {
			if err := pkg.Close(); err != nil {
				slog.Error("关闭资源失败", "module", "resourceimport", "operation", "loadImport", "error", err)
			}
			previous()
		}
	}
	if containsSection(loaded.sections, "agent") {
		loaded.pkg, err = ParseReader(reader, size)
		if err == nil {
			loaded.items, err = ParseResources(loaded.pkg)
		}
		if err != nil {
			err = resource.Invalid(err.Error())
		}
	}
	return
}

func (loaded loadedImport) finish(ctx context.Context) error {
	if loaded.tx == nil {
		return nil
	}
	if err := sqlc.New(loaded.tx).FinishImportUpload(ctx, loaded.input.UploadID); err != nil {
		return err
	}
	return loaded.tx.Commit(ctx)
}
