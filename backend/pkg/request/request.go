package request

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Client struct {
	scheme string
	host   string
	client *http.Client
	tr     *http.Transport
	debug  bool
}

func NewClient(scheme string, host string, timeout time.Duration, opts ...ReqOpt) *Client {
	req := &Client{
		scheme: scheme,
		host:   host,
		client: &http.Client{
			Timeout: timeout,
		},
		debug: false,
	}

	for _, opt := range opts {
		opt(req)
	}

	if req.tr != nil {
		req.client.Transport = req.tr
	}

	return req
}

func (c *Client) SetDebug(debug bool) {
	c.debug = debug
}

func (c *Client) SetTransport(tr *http.Transport) {
	c.client.Transport = tr
}

func sendRequest[T any](c *Client, method, path string, opts ...Opt) (*T, error) {
	u := url.URL{
		Scheme: c.scheme,
		Host:   c.host,
		Path:   path,
	}
	ctx := &Ctx{}
	rid := uuid.NewString()

	for _, opt := range opts {
		opt(ctx)
	}

	if len(ctx.query) > 0 {
		values := u.Query()
		for k, v := range ctx.query {
			values.Add(k, v)
		}
		u.RawQuery = values.Encode()
	}

	if c.debug {
		log.Printf("[REQ:%s] url: %s", rid, u.String())
	}

	var body io.Reader
	var writer *multipart.Writer
	if ctx.body != nil {
		bs, err := json.Marshal(ctx.body)
		if err != nil {
			return nil, err
		}
		switch ctx.contentType {
		case "multipart/form-data":
			m := make(map[string]string)
			if err := json.Unmarshal(bs, &m); err != nil {
				return nil, err
			}
			buf := &bytes.Buffer{}
			writer = multipart.NewWriter(buf)
			for k, v := range m {
				if err := writer.WriteField(k, v); err != nil {
					return nil, err
				}
			}
			writer.Close()
			body = buf
		case "application/x-www-form-urlencoded":
			m := make(map[string]string)
			if err := json.Unmarshal(bs, &m); err != nil {
				return nil, err
			}
			data := url.Values{}
			for k, v := range m {
				data.Add(k, v)
			}
			body = strings.NewReader(data.Encode())
		default:
			body = bytes.NewBuffer(bs)
		}

		if c.debug {
			buf := &bytes.Buffer{}
			json.Indent(buf, bs, "", "  ")
			log.Printf("[REQ:%s] body: %s", rid, buf.String())
		}
	}
	req, err := http.NewRequest(method, u.String(), body)
	if err != nil {
		return nil, err
	}
	for k, v := range ctx.header {
		req.Header.Add(k, v)
	}
	switch ctx.contentType {
	case "multipart/form-data":
		req.Header.Set("Content-Type", writer.FormDataContentType())
	case "application/x-www-form-urlencoded":
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	default:
		req.Header.Set("Content-Type", "application/json")
	}
	if c.debug {
		log.Printf("[REQ:%s] headers: %+v", rid, req.Header)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if c.debug {
		buf := &bytes.Buffer{}
		if err := json.Indent(buf, b, "", "  "); err != nil {
			log.Printf("[REQ:%s] resp: %s", rid, string(b))
		} else {
			log.Printf("[REQ:%s] resp: %s", rid, buf.String())
		}
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status code: %d", resp.StatusCode)
	}

	var rr T
	if err := json.Unmarshal(b, &rr); err != nil {
		return nil, err
	}
	return &rr, nil
}

func Get[T any](c *Client, path string, opts ...Opt) (*T, error) {
	return sendRequest[T](c, http.MethodGet, path, opts...)
}

func Post[T any](c *Client, path string, body any, opts ...Opt) (*T, error) {
	opts = append(opts, WithBody(body))
	return sendRequest[T](c, http.MethodPost, path, opts...)
}

func Put[T any](c *Client, path string, body any, opts ...Opt) (*T, error) {
	opts = append(opts, WithBody(body))
	return sendRequest[T](c, http.MethodPut, path, opts...)
}

func Delete[T any](c *Client, path string, opts ...Opt) (*T, error) {
	return sendRequest[T](c, http.MethodDelete, path, opts...)
}
