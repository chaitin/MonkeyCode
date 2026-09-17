package endpoint

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"
)

type connection struct {
	service                   *Service
	ws                        *websocket.Conn
	credential                Credential
	user                      *userState
	machine                   string
	ctx                       context.Context
	cancel                    context.CancelFunc
	done, ready, finished     chan struct{}
	once                      sync.Once
	dead                      atomic.Bool
	code                      atomic.Int32
	seen                      atomic.Int64
	mu                        sync.Mutex
	business, errors          [][]byte
	businessBytes, errorBytes int
	directory                 []byte
	fullSince                 time.Time
	wake                      chan struct{}
	messages, bytes           bucket
	limited                   time.Time
}

func (c *connection) valid() bool { return !c.dead.Load() && time.Now().Before(c.credential.ExpiresAt) }
func (c *connection) stop(code int) {
	c.once.Do(func() { c.code.Store(int32(code)); c.dead.Store(true); close(c.done) })
}
func (c *connection) notify() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}
func (c *connection) snapshot(data []byte) {
	c.mu.Lock()
	c.directory = data
	c.mu.Unlock()
	c.notify()
}
func (c *connection) enqueue(data []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.valid() {
		return false
	}
	if len(c.business) >= 64 || c.businessBytes+len(data) > 2<<20 {
		if c.fullSince.IsZero() {
			c.fullSince = time.Now()
		}
		return false
	}
	c.business = append(c.business, data)
	c.businessBytes += len(data)
	c.notify()
	return true
}
func (c *connection) reject(code, id string) {
	if !validID(id) {
		id = ""
	}
	data := errorFrame(code, id)
	c.service.stats.rejected.Add(1)
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.errors) >= 16 || c.errorBytes+len(data) > 64<<10 {
		c.stop(1013)
		return
	}
	c.errors = append(c.errors, data)
	c.errorBytes += len(data)
	c.notify()
}
func (c *connection) pop(high bool) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if high || len(c.business) == 0 {
		if len(c.errors) > 0 {
			data := c.errors[0]
			c.errors[0] = nil
			c.errors = c.errors[1:]
			c.errorBytes -= len(data)
			return data, true
		}
		if c.directory != nil {
			data := c.directory
			c.directory = nil
			return data, true
		}
	}
	if len(c.business) > 0 {
		data := c.business[0]
		c.business[0] = nil
		c.business = c.business[1:]
		c.businessBytes -= len(data)
		if len(c.business) < 64 && c.businessBytes < 2<<20 {
			c.fullSince = time.Time{}
		}
		return data, false
	}
	return nil, false
}
func (c *connection) write(data []byte) bool {
	ctx, cancel := context.WithTimeout(c.ctx, c.service.timeWrite)
	defer cancel()
	if err := c.ws.Write(ctx, websocket.MessageText, data); err != nil {
		c.stop(1013)
		return false
	}
	return true
}
func (c *connection) writer() {
	defer func() {
		code := c.code.Load()
		if code == 0 {
			code = 1000
		}
		_ = c.ws.Close(websocket.StatusCode(code), "")
		c.cancel()
	}()
	select {
	case <-c.done:
		return
	case <-c.ready:
	}
	if !c.valid() {
		c.stop(4003)
		return
	}
	welcome := map[string]any{"type": "welcome", "protocol_version": 1, "server_time": time.Now().UnixMilli(), "heartbeat": map[string]int64{"interval_ms": c.service.pingInterval.Milliseconds(), "timeout_ms": c.service.timePong.Milliseconds()}, "limits": map[string]int{"max_frame_bytes": maxMessage, "max_endpoints": 20}}
	data, _ := json.Marshal(welcome)
	if !c.write(data) {
		return
	}
	c.mu.Lock()
	data = c.directory
	c.directory = nil
	c.mu.Unlock()
	if data == nil || !c.write(data) {
		c.stop(1011)
		return
	}
	streak := 0
	for {
		if !c.valid() {
			if !c.dead.Load() {
				c.stop(4003)
			}
			return
		}
		data, high := c.pop(streak < 8)
		if data != nil {
			if !c.valid() {
				return
			}
			if !c.write(data) {
				return
			}
			if high {
				streak++
			} else {
				streak = 0
			}
			continue
		}
		select {
		case <-c.done:
			return
		case <-c.ctx.Done():
			return
		case <-c.wake:
		}
	}
}
func (c *connection) reader() {
	violations := 0
	for {
		kind, data, err := c.ws.Read(c.ctx)
		if err != nil {
			c.stop(1000)
			return
		}
		if kind != websocket.MessageText {
			c.stop(1002)
			return
		}
		if !utf8.Valid(data) {
			c.stop(1007)
			return
		}
		var envelope map[string]json.RawMessage
		var messageType string
		_ = json.Unmarshal(data, &envelope)
		_ = json.Unmarshal(envelope["type"], &messageType)
		if messageType == "hello" {
			c.stop(1002)
			return
		}
		m, err := message(data)
		if err != nil {
			c.reject("invalid_message", "")
			violations++
			if violations >= 3 {
				c.stop(1008)
				return
			}
			continue
		}
		violations = 0
		c.service.route(c, m, len(data))
	}
}
func (c *connection) ping() {
	ticker := time.NewTicker(c.service.pingInterval)
	defer ticker.Stop()
	last := time.Now()
	for {
		select {
		case <-c.done:
			return
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(c.ctx, c.service.timePong)
			err := c.ws.Ping(ctx)
			cancel()
			if err != nil {
				c.stop(1013)
				return
			}
			now := time.Now()
			c.seen.Store(now.UnixMilli())
			c.mu.Lock()
			stalled := !c.fullSince.IsZero() && now.Sub(c.fullSince) >= 30*time.Second
			c.mu.Unlock()
			if stalled {
				c.stop(1013)
				return
			}
			if now.Sub(last) >= 60*time.Second {
				ctx, cancel := context.WithTimeout(c.ctx, c.service.timeDB)
				err = c.service.store.Touch(ctx, c.credential.UserID, c.machine, now)
				cancel()
				if err != nil {
					c.stop(1013)
					return
				}
				last = now
			}
		}
	}
}
func (c *connection) verify() {
	timer := time.AfterFunc(max(0, time.Until(c.credential.ExpiresAt)), func() { c.stop(4003) })
	defer timer.Stop()
	ticker := time.NewTicker(c.service.verifyInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			code, _ := c.service.check(c.ctx, c.credential)
			if code != 0 {
				c.stop(code)
				return
			}
		}
	}
}
