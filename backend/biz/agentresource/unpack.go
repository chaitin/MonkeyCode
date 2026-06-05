package agentresource

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path"
	"strings"
)

// UnzipLimits guards the in-memory unzipper against zip bombs and overly
// large archives. All limits are inclusive of the value (size == limit is OK).
type UnzipLimits struct {
	MaxFileSize  int64 // per-entry uncompressed size
	MaxTotalSize int64 // sum of all entries' uncompressed sizes
	MaxFiles     int   // max number of file entries
}

// DefaultUnzipLimits is the policy used by the Resolver.
var DefaultUnzipLimits = UnzipLimits{
	MaxFileSize:  32 << 20,  // 32 MiB
	MaxTotalSize: 256 << 20, // 256 MiB
	MaxFiles:     1000,
}

// unzipToMemory reads a zip archive entirely from memory and returns its
// regular file entries. Directories are skipped. Paths are validated to
// reject zip-slip ("../..") and absolute paths. Entries that exceed the
// limits cause the entire archive to be rejected so callers can fall back
// to skipping the whole asset (matching the Resolver's per-skill policy).
func unzipToMemory(data []byte, limits UnzipLimits) ([]MaterializedFile, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("agentresource: open zip: %w", err)
	}

	// Pre-flight file count + declared uncompressed size.
	fileCount := 0
	var totalDeclared uint64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		fileCount++
		totalDeclared += f.UncompressedSize64
	}
	if fileCount > limits.MaxFiles {
		return nil, fmt.Errorf("agentresource: zip has %d files, max %d", fileCount, limits.MaxFiles)
	}
	if totalDeclared > uint64(limits.MaxTotalSize) {
		return nil, fmt.Errorf("agentresource: zip declares %d bytes total, max %d", totalDeclared, limits.MaxTotalSize)
	}

	out := make([]MaterializedFile, 0, fileCount)
	var totalRead int64
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}

		rel, err := sanitizeZipPath(f.Name)
		if err != nil {
			return nil, err
		}

		// Trust-but-verify: even if UncompressedSize64 looks fine, cap
		// per-entry reads to MaxFileSize via io.LimitReader.
		if int64(f.UncompressedSize64) > limits.MaxFileSize {
			return nil, fmt.Errorf("agentresource: zip entry %q declares %d bytes, max %d",
				f.Name, f.UncompressedSize64, limits.MaxFileSize)
		}

		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("agentresource: open zip entry %q: %w", f.Name, err)
		}
		// limit + 1 so a file exactly at the limit reads cleanly but anything
		// larger trips the over-cap check below.
		limited := io.LimitReader(rc, limits.MaxFileSize+1)
		buf, err := io.ReadAll(limited)
		_ = rc.Close()
		if err != nil {
			return nil, fmt.Errorf("agentresource: read zip entry %q: %w", f.Name, err)
		}
		if int64(len(buf)) > limits.MaxFileSize {
			return nil, fmt.Errorf("agentresource: zip entry %q exceeds per-file limit %d",
				f.Name, limits.MaxFileSize)
		}
		totalRead += int64(len(buf))
		if totalRead > limits.MaxTotalSize {
			return nil, fmt.Errorf("agentresource: zip exceeds total limit %d after entry %q",
				limits.MaxTotalSize, f.Name)
		}

		out = append(out, MaterializedFile{RelPath: rel, Content: buf})
	}
	return out, nil
}

// sanitizeZipPath rejects entries that try to escape the archive root via
// "..", absolute paths, or backslash separators. Forward-slash separators
// are preserved as-is so callers can write them out as relative paths.
func sanitizeZipPath(name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("agentresource: empty zip entry name")
	}
	// Reject Windows-style separators outright — Skill/Plugin packagers
	// must use POSIX paths.
	if strings.Contains(name, `\`) {
		return "", fmt.Errorf("agentresource: zip entry %q uses backslash separator", name)
	}
	// Reject absolute paths.
	if strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("agentresource: zip entry %q is absolute", name)
	}
	// path.Clean collapses ".." segments; if the result starts with ".."
	// or equals "..", it tried to escape.
	cleaned := path.Clean(name)
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("agentresource: zip-slip rejected for entry %q", name)
	}
	if cleaned == "." {
		return "", fmt.Errorf("agentresource: zip entry %q resolves to root", name)
	}
	return cleaned, nil
}
