package resourceimport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

const ChunkSize int64 = 64 << 20

var volumeName = regexp.MustCompile(`(?i)^(.+\.zip)\.([0-9]{3,6})$`)

type UploadFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type Chunk struct {
	Index  int    `json:"index"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Upload struct {
	ID            string       `json:"id"`
	Files         []UploadFile `json:"files"`
	TotalSize     int64        `json:"total_size"`
	Status        string       `json:"status"`
	PackageSHA256 string       `json:"package_sha256"`
	CreatedAt     time.Time    `json:"created_at"`
	ExpiresAt     time.Time    `json:"expires_at"`
	ChunkSize     int64        `json:"chunk_size"`
	Chunks        []Chunk      `json:"chunks"`
}

func validateUpload(files []UploadFile) (int64, error) {
	if len(files) == 0 || len(files) > 256 {
		return 0, resource.Invalid("请选择 ZIP 或全部分卷，最多 256 卷")
	}
	var total int64
	base := ""
	for i, file := range files {
		if !safePath(file.Name) || strings.Contains(file.Name, "/") || !utf8.ValidString(file.Name) || len(file.Name) > 255 || file.Size <= 0 || file.Size > MaxPackage-total {
			return 0, resource.Invalid("文件名或大小无效，资源包总大小不得超过 2 GiB")
		}
		total += file.Size
		if len(files) == 1 && strings.HasSuffix(strings.ToLower(file.Name), ".zip") {
			continue
		}
		match := volumeName.FindStringSubmatch(file.Name)
		if match == nil {
			return 0, resource.Invalid("请选择普通 ZIP，或按字节拆分的 .zip.001、.002 等全部分卷；不支持 .z01 或 7z 分卷")
		}
		n, _ := strconv.Atoi(match[2])
		if n != i+1 || (base != "" && !strings.EqualFold(base, match[1])) {
			return 0, resource.Invalid("分卷编号必须从 001 连续递增，且属于同一资源包")
		}
		base = match[1]
	}
	return total, nil
}

func (u Upload) chunkCount() int { return int((u.TotalSize + ChunkSize - 1) / ChunkSize) }
func (u Upload) chunkSize(index int) int64 {
	if index < 0 || index >= u.chunkCount() {
		return 0
	}
	return min(ChunkSize, u.TotalSize-int64(index)*ChunkSize)
}
func (u Upload) chunkKey(index int) string {
	return fmt.Sprintf("resource-import/uploads/%s/%d", u.ID, index)
}

func decodeUpload(data []byte) (Upload, error) {
	var upload Upload
	err := decodeJSON(data, &upload)
	upload.ChunkSize, upload.Chunks = ChunkSize, []Chunk{}
	return upload, err
}

func (s *Service) uploadChunks(ctx context.Context, q resource.Queryer, upload *Upload) error {
	rows, err := sqlc.New(q).ListImportChunks(ctx, upload.ID)
	if err != nil {
		return err
	}
	for _, data := range rows {
		var chunk Chunk
		if err := decodeJSON(data, &chunk); err != nil {
			return err
		}
		upload.Chunks = append(upload.Chunks, chunk)
	}
	return nil
}

func (s *Service) lockUpload(ctx context.Context, id, actor string) (Upload, pgx.Tx, error) {
	if _, err := uuid.Parse(id); err != nil {
		return Upload{}, nil, resource.NotFound
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Upload{}, nil, err
	}
	data, err := sqlc.New(tx).LockImportUpload(ctx, sqlc.LockImportUploadParams{ID: id, ActorUserID: actor})
	if err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return Upload{}, nil, err
	}
	upload, err := decodeUpload(data)
	if err == nil {
		err = s.uploadChunks(ctx, tx, &upload)
	}
	if err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return Upload{}, nil, err
	}
	return upload, tx, nil
}

func (s *Service) RegisterUploads(router chi.Router) {
	router.Route("/resource-import-uploads", func(router chi.Router) {
		router.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				actor, ok := identity.UserFromContext(r.Context())
				if !ok || actor.Role != "admin" {
					resource.Fail(w, resource.NotFound)
					return
				}
				next.ServeHTTP(w, r)
			})
		})
		router.Post("/", s.createUpload)
		router.Get("/", s.listUploads)
		router.Get("/{id}", s.getUpload)
		router.Put("/{id}/chunks/{index}", s.putChunk)
		router.Post("/{id}/complete", s.completeUpload)
		router.Delete("/{id}", s.cancelUpload)
	})
}

func (s *Service) createUpload(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Files []UploadFile `json:"files"`
	}
	if err := resource.Decode(w, r, &input); err != nil {
		resource.Fail(w, err)
		return
	}
	total, err := validateUpload(input.Files)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	actor, _ := identity.UserFromContext(r.Context())
	data, err := sqlc.New(s.Pool).CreateImportUpload(r.Context(), payload(resource.Object{
		"id": resource.ID(), "actor_user_id": actor.ID, "files": input.Files, "total_size": total,
	}))
	if errors.Is(err, pgx.ErrNoRows) {
		err = conflict("最多保留 5 个未完成上传任务，请先继续或放弃已有任务")
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	upload, err := decodeUpload(data)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusCreated, upload)
}

func (s *Service) listUploads(w http.ResponseWriter, r *http.Request) {
	actor, _ := identity.UserFromContext(r.Context())
	rows, err := sqlc.New(s.Pool).ListImportUploads(r.Context(), actor.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	uploads := []Upload{}
	for _, data := range rows {
		upload, err := decodeUpload(data)
		if err == nil {
			err = s.uploadChunks(r.Context(), s.Pool, &upload)
		}
		if err != nil {
			resource.Fail(w, err)
			return
		}
		uploads = append(uploads, upload)
	}
	resource.JSON(w, http.StatusOK, resource.Object{"items": uploads})
}

func (s *Service) getUpload(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		resource.Fail(w, resource.NotFound)
		return
	}
	actor, _ := identity.UserFromContext(r.Context())
	data, err := sqlc.New(s.Pool).GetImportUpload(r.Context(), sqlc.GetImportUploadParams{ID: id, ActorUserID: actor.ID})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	upload, err := decodeUpload(data)
	if err == nil {
		err = s.uploadChunks(r.Context(), s.Pool, &upload)
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, upload)
}

func (s *Service) putChunk(w http.ResponseWriter, r *http.Request) {
	actor, _ := identity.UserFromContext(r.Context())
	upload, tx, err := s.lockUpload(r.Context(), chi.URLParam(r, "id"), actor.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(context.WithoutCancel(r.Context()))
	index, err := strconv.Atoi(chi.URLParam(r, "index"))
	size := upload.chunkSize(index)
	if err != nil || size == 0 {
		resource.Fail(w, resource.Invalid("传输块编号无效"))
		return
	}
	if upload.Status != "uploading" {
		resource.Fail(w, conflict("上传内容已封存，不能再修改"))
		return
	}
	expected := r.Header.Get("X-Content-SHA256")
	if len(expected) != 71 || !strings.HasPrefix(expected, "sha256:") {
		resource.Fail(w, resource.Invalid("缺少传输块 SHA-256"))
		return
	}
	file, err := os.CreateTemp("", "resource-import-chunk-*")
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer func() { _ = file.Close(); _ = os.Remove(file.Name()) }()
	hash := sha256.New()
	length, err := io.Copy(io.MultiWriter(file, hash), http.MaxBytesReader(w, r.Body, size))
	if err != nil || length != size || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != expected {
		resource.Fail(w, resource.Invalid("传输块大小或校验值不匹配，请重试"))
		return
	}
	for _, chunk := range upload.Chunks {
		if chunk.Index == index {
			if chunk.SHA256 != expected {
				resource.Fail(w, conflict("该传输块已有不同内容，请重新选择资源包创建任务"))
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		resource.Fail(w, err)
		return
	}
	if writer, ok := s.Storage.(interface {
		PutReader(context.Context, string, io.ReadSeeker, int64, string) error
	}); ok {
		err = writer.PutReader(r.Context(), upload.chunkKey(index), file, size, "application/octet-stream")
	} else {
		var body []byte
		body, err = io.ReadAll(file)
		if err == nil {
			err = s.Storage.Put(r.Context(), upload.chunkKey(index), body, "application/octet-stream")
		}
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if err := sqlc.New(tx).CreateImportChunk(r.Context(), payload(resource.Object{
		"upload_id": upload.ID, "index": index, "size": size, "sha256": expected,
	})); err != nil {
		resource.Fail(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		resource.Fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) completeUpload(w http.ResponseWriter, r *http.Request) {
	actor, _ := identity.UserFromContext(r.Context())
	upload, tx, err := s.lockUpload(r.Context(), chi.URLParam(r, "id"), actor.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(context.WithoutCancel(r.Context()))
	if upload.Status != "uploading" {
		resource.JSON(w, http.StatusOK, upload)
		return
	}
	reader, sha, cleanup, err := s.openUpload(r.Context(), upload)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer cleanup()
	pkg, err := ParseReader(reader, upload.TotalSize)
	if err == nil {
		for name, entry := range pkg.entries {
			stream, openErr := entry.Open()
			if openErr != nil {
				err = fmt.Errorf("打开文件 %s: %w", name, openErr)
				break
			}
			n, readErr := io.Copy(io.Discard, io.LimitReader(stream, int64(entry.UncompressedSize64)+1))
			closeErr := stream.Close()
			if readErr != nil || closeErr != nil || uint64(n) != entry.UncompressedSize64 {
				err = fmt.Errorf("文件 %s 损坏，请检查分卷是否完整且来自同一资源包", name)
				break
			}
		}
	}
	if err != nil {
		resource.Fail(w, resource.Invalid("资源包不完整或格式无效："+err.Error()))
		return
	}
	if err := sqlc.New(tx).ReadyImportUpload(r.Context(), sqlc.ReadyImportUploadParams{ID: upload.ID, PackageSha256: sha}); err != nil {
		resource.Fail(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		resource.Fail(w, err)
		return
	}
	upload.Status, upload.PackageSHA256 = "ready", sha
	resource.JSON(w, http.StatusOK, upload)
}

func (s *Service) cancelUpload(w http.ResponseWriter, r *http.Request) {
	actor, _ := identity.UserFromContext(r.Context())
	upload, tx, err := s.lockUpload(r.Context(), chi.URLParam(r, "id"), actor.ID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer tx.Rollback(context.WithoutCancel(r.Context()))
	if upload.Status == "imported" {
		resource.Fail(w, conflict("该任务已完成导入"))
		return
	}
	if err := sqlc.New(tx).CancelImportUpload(r.Context(), upload.ID); err != nil {
		resource.Fail(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		resource.Fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) CleanupUploads(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	rows, err := sqlc.New(tx).ListExpiredImportUploads(ctx)
	if err != nil {
		return err
	}
	for _, data := range rows {
		upload, err := decodeUpload(data)
		if err != nil {
			return err
		}
		// 同时删除可能在数据库提交失败时遗留的对象。
		for i := range upload.chunkCount() {
			if err := s.Storage.Delete(ctx, upload.chunkKey(i)); err != nil {
				return err
			}
		}
		if err := sqlc.New(tx).DeleteImportUpload(ctx, upload.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		cleanupCtx, cancel := context.WithTimeout(ctx, 50*time.Second)
		err := s.CleanupUploads(cleanupCtx)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.WarnContext(ctx, "清理资源包上传失败", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
