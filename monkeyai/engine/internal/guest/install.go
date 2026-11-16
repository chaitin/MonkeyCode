package guest

import (
	"archive/tar"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/runtimeupdate"
)

type runtimeInstall struct {
	Binding Binding                  `json:"binding"`
	Release lifecycle.RuntimePackage `json:"release"`
}

func (s *Service) installRuntime(w http.ResponseWriter, r *http.Request) {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(r.Header.Get("X-MonkeyAI-Request"))
	var in runtimeInstall
	if err != nil || len(raw) > 16<<10 || json.Unmarshal(raw, &in) != nil || in.Binding != s.binding || in.Release.Validate() != nil {
		w.WriteHeader(403)
		return
	}
	backend, ok := s.backend.(interface {
		Install(context.Context, lifecycle.RuntimePackage, io.Reader) error
	})
	if !ok {
		w.WriteHeader(404)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(10 * time.Minute))
	body := http.MaxBytesReader(w, r.Body, 1<<30)
	if err := backend.Install(ctx, in.Release, body); err != nil {
		w.WriteHeader(409)
		return
	}
	w.WriteHeader(204)
}
func (c *Client) Install(ctx context.Context, release lifecycle.RuntimePackage, open func(string) (io.ReadCloser, error)) error {
	if err := release.Validate(); err != nil {
		return err
	}
	if open == nil {
		return errors.New("缺少runtime固定输入")
	}
	raw, err := json.Marshal(runtimeInstall{Binding: c.binding, Release: release})
	if err != nil {
		return err
	}
	reader, writer := io.Pipe()
	defer reader.Close()
	done := make(chan error, 1)
	go func() {
		tw := tar.NewWriter(writer)
		var result error
		for _, name := range []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json"} {
			expected, ok := release.Files[name]
			if !ok {
				continue
			}
			if err := ctx.Err(); err != nil {
				result = err
				break
			}
			file, err := open(name)
			if err != nil {
				result = err
				break
			}
			if err = tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0600, Size: expected.Size}); err == nil {
				var n int64
				n, err = io.CopyN(tw, file, expected.Size)
				if n != expected.Size && err == nil {
					err = io.ErrUnexpectedEOF
				}
			}
			result = errors.Join(err, file.Close())
			if result != nil {
				break
			}
		}
		result = errors.Join(result, tw.Close())
		writer.CloseWithError(result)
		done <- result
	}()
	request, err := http.NewRequestWithContext(ctx, "POST", "http://guest/v1/runtime", reader)
	if err != nil {
		reader.CloseWithError(err)
		<-done
		return err
	}
	request.Header.Set("Content-Type", "application/x-tar")
	request.Header.Set("X-MonkeyAI-Request", base64.RawURLEncoding.EncodeToString(raw))
	transport := c.transport.Clone()
	transport.ResponseHeaderTimeout = 11 * time.Minute
	defer transport.CloseIdleConnections()
	client := *c.http
	client.Transport = transport
	response, err := client.Do(request)
	if err != nil {
		reader.CloseWithError(err)
		<-done
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 204 {
		reader.CloseWithError(errors.New("虚拟机拒绝runtime更新"))
		<-done
		return errors.New("虚拟机拒绝runtime更新")
	}
	return <-done
}
func (p *Process) Install(ctx context.Context, release lifecycle.RuntimePackage, body io.Reader) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.serve != nil || release.Validate() != nil || release.Architecture != runtime.GOARCH {
		return errors.New("runtime更新需要尚未执行用户进程的启动")
	}
	stage, err := os.MkdirTemp("/var/lib/monkeyai", ".runtime-upload-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err := receiveRuntime(ctx, stage, release, body); err != nil {
		return err
	}
	manager := runtimeupdate.New("/var/lib/monkeyai", nil).WithFetcher(func(ctx context.Context, _ lifecycle.RuntimePackage, name string) (io.ReadCloser, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return os.Open(filepath.Join(stage, name))
	}).WithPreparer(prepareRuntime)
	return manager.Update(ctx, release)
}
func receiveRuntime(ctx context.Context, stage string, release lifecycle.RuntimePackage, body io.Reader) error {
	tr := tar.NewReader(io.LimitReader(body, (1<<30)+1))
	seen := map[string]bool{}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		expected, ok := release.Files[header.Name]
		if !ok || seen[header.Name] || header.Typeflag != tar.TypeReg || header.Size != expected.Size || header.Linkname != "" {
			return errors.New("runtime传输包含未知、重复或链接条目")
		}
		seen[header.Name] = true
		file, err := os.OpenFile(filepath.Join(stage, header.Name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		_, copyErr := io.CopyN(file, tr, header.Size)
		if err := errors.Join(copyErr, file.Sync(), file.Close()); err != nil {
			return err
		}
	}
	if len(seen) != len(release.Files) {
		return errors.New("runtime传输文件不完整")
	}
	return nil
}
