package taskflow

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"

	"github.com/coder/websocket"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type fileManageClient struct {
	client *request.Client
}

func newFileManageClient(client *request.Client) FileManager {
	return &fileManageClient{
		client: client,
	}
}

// Operate implements FileManager.
func (f *fileManageClient) Operate(ctx context.Context, req FileReq) ([]*File, error) {
	resp, err := request.Post[Resp[[]*File]](f.client, ctx, "/internal/files", req)
	if err != nil {
		return []*File{}, err
	}
	if resp.Code != 0 {
		return nil, fmt.Errorf("%s", resp.Message)
	}
	if resp.Data == nil {
		resp.Data = []*File{}
	}
	return resp.Data, nil
}

// Download implements FileManager.
func (f *fileManageClient) Download(ctx context.Context, req FileReq, fn func(uint64, []byte) error) error {
	wsScheme := "ws"
	if f.client.GetScheme() == "https" {
		wsScheme = "wss"
	}

	u := &url.URL{
		Scheme: wsScheme,
		Host:   f.client.GetHost(),
		Path:   "/internal/ws/files/download",
	}

	values := url.Values{}
	values.Add("id", req.ID)
	values.Add("path", req.Path)
	u.RawQuery = values.Encode()

	conn, _, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{})
	if err != nil {
		return err
	}
	defer conn.Close(websocket.StatusGoingAway, "Closing connection due to context cancellation or other reasons.")
	conn.SetReadLimit(-1)

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		tp, data, err := conn.Read(ctx)
		if err != nil {
			var closeErr websocket.CloseError
			switch {
			case errors.As(err, &closeErr):
				return nil
			case errors.Is(err, io.EOF):
				return nil
			default:
				conn.CloseNow()
				return err
			}
		}

		switch tp {
		case websocket.MessageBinary:
			if err := fn(0, data); err != nil {
				conn.CloseNow()
				return err
			}

		case websocket.MessageText:
			if string(data) == "DONE" {
				return nil
			}

			if after, ok := strings.CutPrefix(string(data), "ERR:"); ok {
				return fmt.Errorf("%s", after)
			}

			if after, ok := strings.CutPrefix(string(data), "SIZE:"); ok {
				size, _ := strconv.ParseUint(after, 10, 64)
				if err := fn(size, nil); err != nil {
					conn.CloseNow()
					return err
				}
			}
		}
	}
}

// Upload implements FileManager.
func (f *fileManageClient) Upload(ctx context.Context, req FileReq, data <-chan []byte) error {
	wsScheme := "ws"
	if f.client.GetScheme() == "https" {
		wsScheme = "wss"
	}

	u := &url.URL{
		Scheme: wsScheme,
		Host:   f.client.GetHost(),
		Path:   "/internal/ws/files/upload",
	}

	values := url.Values{}
	values.Add("id", req.ID)
	values.Add("path", req.Path)
	u.RawQuery = values.Encode()

	conn, _, err := websocket.Dial(ctx, u.String(), &websocket.DialOptions{})
	if err != nil {
		return err
	}
	defer conn.Close(websocket.StatusNormalClosure, "upload completed")
	conn.SetReadLimit(-1)

	for d := range data {
		if err := conn.Write(ctx, websocket.MessageBinary, d); err != nil {
			return err
		}
	}

	// 发送 EOF 信号
	if err := conn.Write(ctx, websocket.MessageText, []byte("EOF")); err != nil {
		return err
	}

	// 等待服务端确认
	msgType, msg, err := conn.Read(ctx)
	if err != nil {
		return fmt.Errorf("failed to read upload confirmation: %w", err)
	}

	if msgType != websocket.MessageText {
		return fmt.Errorf("unexpected confirmation message type: %v, expected text", msgType)
	}

	if string(msg) == "DONE" {
		return nil
	}

	if after, ok := strings.CutPrefix(string(msg), "ERR:"); ok {
		return fmt.Errorf("%s", after)
	}

	return fmt.Errorf("unexpected upload response: %s", string(msg))
}
