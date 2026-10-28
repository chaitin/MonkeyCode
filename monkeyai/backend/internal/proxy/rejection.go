package proxy

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
)

const maxRejectionBytes = 16 << 10

type rejectionCapture struct {
	io.ReadCloser
	data     []byte
	complete bool
	log      func([]slog.Attr)
}

func (p *Proxy) captureRejection(response *http.Response, pc *proxyContext, call Call) io.ReadCloser {
	return &rejectionCapture{ReadCloser: response.Body, log: func(attrs []slog.Attr) {
		p.logCall(response.Request.Context(), pc, call, nil, attrs...)
	}}
}

func (c *rejectionCapture) Read(buffer []byte) (int, error) {
	n, err := c.ReadCloser.Read(buffer)
	if n > 0 && len(c.data) <= maxRejectionBytes {
		c.data = append(c.data, buffer[:min(n, maxRejectionBytes+1-len(c.data))]...)
	}
	if err == io.EOF {
		c.complete = true
	}
	return n, err
}

func (c *rejectionCapture) Close() error {
	var attrs []slog.Attr
	if c.complete && len(c.data) <= maxRejectionBytes {
		var response struct {
			Error struct {
				Code  string `json:"code"`
				Type  string `json:"type"`
				Param string `json:"param"`
			} `json:"error"`
		}
		if json.Unmarshal(c.data, &response) == nil {
			attrs = []slog.Attr{slog.String("upstream_error_code", response.Error.Code),
				slog.String("upstream_error_type", response.Error.Type), slog.String("upstream_error_param", response.Error.Param)}
		}
	}
	c.log(attrs)
	return c.ReadCloser.Close()
}
