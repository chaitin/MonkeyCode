package audit

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type requestKey struct{}
type requestState struct {
	id, ip, agent string
	actor         Actor
	at            time.Time
}

func Identify(ctx context.Context, actor Actor) {
	if state, ok := ctx.Value(requestKey{}).(*requestState); ok {
		state.actor = actor
	}
}

type capture struct {
	bytes.Buffer
	overflow bool
}

func (b *capture) Write(p []byte) (int, error) {
	n := len(p)
	if n > bodyLimit-b.Len() {
		b.overflow = true
	}
	_, _ = b.Buffer.Write(p[:min(n, bodyLimit-b.Len())])
	return n, nil
}

type bodyReader struct {
	io.Reader
	io.Closer
}

func (s *Service) Middleware(actor func(*http.Request) Actor) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case "POST", "PUT", "PATCH", "DELETE":
			default:
				next.ServeHTTP(w, r)
				return
			}
			user := actor(r)
			if user.Name == "" {
				next.ServeHTTP(w, r)
				return
			}
			var random [16]byte
			if _, err := rand.Read(random[:]); err != nil {
				failure(w, 500, "server_error", "初始化操作审计失败")
				return
			}
			state := &requestState{id: hex.EncodeToString(random[:]), actor: user, at: time.Now().UTC(), ip: sourceIP(r.RemoteAddr), agent: clean(r.UserAgent(), 512)}
			r = r.WithContext(context.WithValue(r.Context(), requestKey{}, state))
			var body, response capture
			media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if r.Body != nil && media == "application/json" {
				r.Body = bodyReader{Reader: io.TeeReader(r.Body, &body), Closer: r.Body}
			}
			writer := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			writer.Tee(&response)
			defer func() {
				panicked := recover()
				status := writer.Status()
				if status == 0 {
					status = 200
				}
				if panicked != nil {
					status = 500
				}
				ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
				defer cancel()
				if err := s.complete(ctx, r, state, &body, &response, media, status); err != nil {
					s.logger.Error("操作审计写入失败", "request_id", state.id, "method", r.Method, "status", status)
				}
				if panicked != nil {
					panic(panicked)
				}
			}()
			next.ServeHTTP(writer, r)
		})
	}
}

func sourceIP(remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	ip, err := netip.ParseAddr(host)
	if err != nil {
		return ""
	}
	return ip.WithZone("").Unmap().String()
}

func routeEvent(r *http.Request) Event {
	pattern := chi.RouteContext(r.Context()).RoutePattern()
	if strings.HasPrefix(pattern, "/api/auth/v1/") {
		action := "sign_in"
		if strings.HasSuffix(pattern, "/logout") {
			action = "sign_out"
		}
		return Event{Category: "security", TargetType: "user", Action: action}
	}
	path := strings.TrimPrefix(pattern, "/api/admin/v1")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	event := Event{Category: "resource", TargetType: parts[0]}
	switch parts[0] {
	case "models":
		event.Category, event.TargetType = "model", "model"
	case "users", "groups":
		event.Category = "identity"
		event.TargetType = strings.TrimSuffix(parts[0], "s")
	case "settings":
		event.Category, event.TargetType = "settings", "setting"
	case "api-keys":
		event.Category, event.TargetType = "security", "api_key"
	case "billing":
		event.Category = "billing"
		if len(parts) > 1 {
			event.TargetType = parts[1]
		}
	case "rules", "skills", "experts", "connectors", "tags":
		event.TargetType = strings.TrimSuffix(parts[0], "s")
	case "connector-providers":
		event.TargetType = "provider"
	case "resources":
		event.TargetType = chi.URLParam(r, "type")
	}
	event.Action = map[string]string{"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}[r.Method]
	if len(parts) > 2 && !strings.Contains(parts[len(parts)-1], "{") {
		event.Action = strings.ReplaceAll(parts[len(parts)-1], "-", "_")
	}
	for _, key := range []string{"toolID", "modelID", "userID", "groupID", "keyID", "id"} {
		if id := chi.URLParam(r, key); uuid(id) != nil {
			event.TargetID = id
			break
		}
	}
	return event
}

func (s *Service) complete(ctx context.Context, r *http.Request, state *requestState, body, response *capture, media string, status int) error {
	event := routeEvent(r)
	if event.Action == "sign_in" || event.Action == "sign_out" {
		event.TargetID = state.actor.ID
	}
	request := map[string]any{"method": r.Method, "route": chi.RouteContext(r.Context()).RoutePattern()}
	section := chi.URLParam(r, "key")
	if section == "" {
		section = chi.URLParam(r, "section")
	}
	if section != "" {
		request["settings_section"] = section
	}
	var input map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body.Bytes()))
	decoder.UseNumber()
	if media == "application/json" && !body.overflow && decoder.Decode(&input) == nil && input != nil {
		request["value"] = input
	} else if r.Body != nil && r.Body != http.NoBody {
		request["body_omitted"] = true
	}
	data, err := params(request)
	if err != nil {
		return err
	}
	result := "success"
	var message *string
	if status >= 400 {
		result = "failed"
		message = new(http.StatusText(status))
	}
	count, err := sqlc.New(s.pool).Complete(ctx, sqlc.CompleteParams{RequestID: new(state.id), Result: result, ErrorMessage: message, RequestParams: data})
	if err != nil || count > 0 {
		return err
	}
	if event.TargetID == "" && status < 400 && !response.overflow {
		var out struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(response.Bytes(), &out) == nil && uuid(out.ID) != nil {
			event.TargetID = out.ID
		}
	}
	return sqlc.New(s.pool).Create(ctx, sqlc.CreateParams{
		ActorUserID: optional(state.actor.ID), ActorName: state.actor.Name, ActorEmail: optional(state.actor.Email),
		Action: event.Action, Category: event.Category, TargetType: optional(event.TargetType), TargetID: uuid(event.TargetID),
		RequestParams: data, SourceIp: state.ip, UserAgent: optional(state.agent), Result: result, ErrorMessage: message,
		OccurredAt: state.at, RequestID: new(state.id),
	})
}
