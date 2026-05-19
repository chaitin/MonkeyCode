package deploy

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"runtime"
	"strings"
)

type DownloadProgress struct {
	Downloaded int64
	Total      int64
}

func (p DownloadProgress) Percent() float64 {
	if p.Total <= 0 {
		return 0
	}
	v := float64(p.Downloaded) / float64(p.Total)
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

type ProgressFunc func(DownloadProgress)

func InstallerArch() string {
	switch runtime.GOARCH {
	case "arm64":
		return "aarch64"
	default:
		return "x86_64"
	}
}

func BundleURL(baseURL, bundlePath string) (string, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return "", err
	}
	u.Path = path.Join(u.Path, bundlePath)
	return u.String(), nil
}

func DownloadFile(ctx context.Context, sourceURL, dest string, progress ProgressFunc) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("unexpected status: %s", resp.Status)
	}

	if err := os.MkdirAll(parentDir(dest), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	reader := &progressReader{reader: resp.Body, total: resp.ContentLength, progress: progress}
	if _, err := io.Copy(out, reader); err != nil {
		return err
	}
	if progress != nil {
		progress(DownloadProgress{Downloaded: reader.downloaded, Total: resp.ContentLength})
	}
	return nil
}

type progressReader struct {
	reader     io.Reader
	downloaded int64
	total      int64
	progress   ProgressFunc
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		r.downloaded += int64(n)
		if r.progress != nil {
			r.progress(DownloadProgress{Downloaded: r.downloaded, Total: r.total})
		}
	}
	return n, err
}

func parentDir(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			return p[:i]
		}
	}
	return "."
}
