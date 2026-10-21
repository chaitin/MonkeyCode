package designcatalog

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"
)

type Storage interface {
	PutImmutable(context.Context, string, io.ReadSeeker, int64, string, string) error
	GetRange(context.Context, string, int64, int64) (io.ReadCloser, error)
	HeadImmutable(context.Context, string) (int64, string, error)
}

func ObjectKey(sha string) string { return "design/sha256/" + strings.TrimPrefix(sha, "sha256:") }
func (s *Service) Prepare(ctx context.Context, p *Package) error {
	uploaded := map[string]bool{}
	for i := range p.Entries {
		e := &p.Entries[i]
		for _, ref := range e.Files {
			if uploaded[ref.SHA256] {
				continue
			}
			f, err := os.Open(p.Source(e.Kind, e.ID, ref.Path))
			if err != nil {
				return err
			}
			err = s.storage.PutImmutable(ctx, ObjectKey(ref.SHA256), f, ref.Size, ref.MIME, ref.SHA256)
			f.Close()
			if err != nil {
				return err
			}
			uploaded[ref.SHA256] = true
		}
		var fields map[string]any
		if err := decode(e.Metadata, &fields); err != nil {
			return err
		}
		if e.Kind != "design-system" && (e.Kind != "template" || fields["downloadable"] != true) {
			continue
		}
		native, err := p.native(ctx, e)
		if err != nil {
			return err
		}
		f, err := os.Open(native.Key)
		if err != nil {
			return err
		}
		err = s.storage.PutImmutable(ctx, ObjectKey(native.SHA256), f, native.Size, "application/zip", native.SHA256)
		f.Close()
		if err != nil {
			return err
		}
		native.Key = ObjectKey(native.SHA256)
		e.Native = native
	}
	return nil
}
func (p *Package) native(ctx context.Context, e *Entry) (_ *Object, err error) {
	f, err := os.CreateTemp(p.dir, "native-")
	if err != nil {
		return nil, err
	}
	defer f.Close()
	defer func() {
		if err != nil {
			os.Remove(f.Name())
		}
	}()
	h := sha256.New()
	z := zip.NewWriter(io.MultiWriter(f, h))
	files := slices.Clone(e.Files)
	slices.SortFunc(files, func(a, b FileRef) int { return strings.Compare(a.Path, b.Path) })
	for _, ref := range files {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		header := &zip.FileHeader{Name: ref.Path, Method: zip.Store}
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		header.SetMode(0644)
		var out io.Writer
		out, err = z.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		src, openErr := os.Open(p.Source(e.Kind, e.ID, ref.Path))
		if openErr != nil {
			return nil, openErr
		}
		n, copyErr := io.Copy(out, src)
		src.Close()
		if copyErr != nil {
			return nil, copyErr
		}
		if n != ref.Size {
			return nil, fmt.Errorf("native ZIP 源文件大小变化: %s", ref.Path)
		}
	}
	if err = z.Close(); err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	return &Object{Key: f.Name(), SHA256: "sha256:" + hex.EncodeToString(h.Sum(nil)), Size: info.Size()}, nil
}
