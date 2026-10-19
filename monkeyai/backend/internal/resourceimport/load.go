package resourceimport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport/sqlc"
	"github.com/jackc/pgx/v5"
)

type importInput struct {
	UploadID      string  `json:"upload_id"`
	Options       Options `json:"options"`
	PackageSHA256 string  `json:"package_sha256"`
	PlanDigest    string  `json:"plan_digest"`
}

type loadedImport struct {
	input   importInput
	pkg     Package
	items   Resources
	sha     string
	cleanup func()
	tx      pgx.Tx
}

func (s *Service) loadImport(w http.ResponseWriter, r *http.Request) (loaded loadedImport, err error) {
	var reader io.ReaderAt
	var size int64
	loaded.cleanup = func() {}
	defer func() {
		if err != nil {
			loaded.cleanup()
		}
	}()
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		if err = resource.Decode(w, r, &loaded.input); err != nil {
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
			return
		}
		loaded.cleanup = func() { _ = loaded.tx.Rollback(context.WithoutCancel(r.Context())) }
		if upload.Status != "ready" && upload.Status != "imported" {
			err = resource.Invalid("请先完成资源包上传和完整性检查")
			return
		}
		var cleanup func()
		reader, loaded.sha, cleanup, err = s.openUpload(r.Context(), upload)
		if err != nil {
			return
		}
		loaded.cleanup = func() {
			cleanup()
			_ = loaded.tx.Rollback(context.WithoutCancel(r.Context()))
		}
		size = upload.TotalSize
	} else {
		r.Body = http.MaxBytesReader(w, r.Body, MaxPackage+(16<<20))
		var file multipart.File
		loaded.cleanup = func() {
			if file != nil {
				_ = file.Close()
			}
			if r.MultipartForm != nil {
				_ = r.MultipartForm.RemoveAll()
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
		hash := sha256.New()
		if _, err = io.Copy(hash, io.NewSectionReader(file, 0, header.Size)); err != nil {
			return
		}
		loaded.sha = "sha256:" + hex.EncodeToString(hash.Sum(nil))
		reader, size = file, header.Size
	}
	loaded.pkg, err = ParseReader(reader, size)
	if err == nil {
		loaded.items, err = ParseResources(loaded.pkg)
	}
	if err != nil {
		err = resource.Invalid(err.Error())
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
