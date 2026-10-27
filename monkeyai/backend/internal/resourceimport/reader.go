package resourceimport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type archiveReader struct {
	files []*os.File
	sizes []int64
}

func (r *archiveReader) ReadAt(buffer []byte, offset int64) (int, error) {
	if offset < 0 {
		return 0, fmt.Errorf("读取偏移量无效")
	}
	if len(buffer) == 0 {
		return 0, nil
	}
	read := 0
	for index, size := range r.sizes {
		if offset >= size {
			offset -= size
			continue
		}
		length := min(int64(len(buffer)-read), size-offset)
		n, err := r.files[index].ReadAt(buffer[read:read+int(length)], offset)
		read += n
		if err != nil {
			return read, err
		}
		if read == len(buffer) {
			return read, nil
		}
		offset = 0
	}
	return read, io.EOF
}

func (s *Service) openUpload(ctx context.Context, upload Upload) (*archiveReader, string, func(), error) {
	if len(upload.Chunks) != upload.chunkCount() {
		return nil, "", nil, resource.Invalid("资源包尚未上传完整，请继续上传缺失部分")
	}
	reader := &archiveReader{}
	cleanup := func() {
		for _, file := range reader.files {
			if err := file.Close(); err != nil {
				slog.Error("关闭资源失败", "module", "resourceimport", "operation", "openUpload", "error", err)
			}
			if err := os.Remove(file.Name()); err != nil && !os.IsNotExist(err) {
				slog.Error("清理临时文件失败", "module", "resourceimport", "operation", "openUpload", "error", err)
			}
		}
	}
	fail := func(err error) (*archiveReader, string, func(), error) {
		cleanup()
		return nil, "", nil, err
	}
	hash := sha256.New()
	for index, chunk := range upload.Chunks {
		if chunk.Index != index || chunk.Size != upload.chunkSize(index) {
			return fail(resource.Invalid("资源包传输块不完整，请重新上传"))
		}
		if err := ctx.Err(); err != nil {
			return fail(err)
		}
		stream, err := s.Storage.Get(ctx, upload.chunkKey(index))
		if err != nil {
			return fail(fmt.Errorf("读取资源包传输块 %d: %w", index+1, err))
		}
		file, err := os.CreateTemp("", "resource-import-*")
		if err != nil {
			if err := stream.Close(); err != nil {
				slog.Error("关闭资源失败", "module", "resourceimport", "operation", "openUpload", "error", err)
			}
			return fail(err)
		}
		reader.files = append(reader.files, file)
		reader.sizes = append(reader.sizes, chunk.Size)
		chunkHash := sha256.New()
		n, readErr := io.Copy(io.MultiWriter(file, hash, chunkHash), io.LimitReader(stream, chunk.Size+1))
		closeErr := stream.Close()
		if readErr != nil {
			return fail(readErr)
		}
		if closeErr != nil {
			return fail(closeErr)
		}
		if n != chunk.Size || "sha256:"+hex.EncodeToString(chunkHash.Sum(nil)) != chunk.SHA256 {
			return fail(resource.Invalid(fmt.Sprintf("资源包传输块 %d 损坏，请重新上传", index+1)))
		}
	}
	sha := "sha256:" + hex.EncodeToString(hash.Sum(nil))
	if upload.PackageSHA256 != "" && upload.PackageSHA256 != sha {
		return fail(resource.Invalid("资源包内容已变化，请重新上传"))
	}
	return reader, sha, cleanup, nil
}
