package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/go-chi/chi/v5"
)

func TestNormalizeCreationGroups(t *testing.T) {
	const id = "abcdefab-1234-4567-89ab-abcdefabcdef"
	for _, tc := range []struct {
		name    string
		input   []string
		want    []string
		invalid bool
	}{
		{name: "omitted"},
		{name: "empty", input: []string{}, want: []string{}},
		{name: "deduplicate canonical UUIDs", input: []string{id, strings.ToUpper(id)}, want: []string{id}},
		{name: "invalid UUID", input: []string{"invalid"}, invalid: true},
		{name: "empty UUID", input: []string{""}, invalid: true},
		{name: "root", input: []string{rootgroup.ID}, invalid: true},
		{name: "compact root", input: []string{strings.Repeat("0", 32)}, invalid: true},
		{name: "too many", input: make([]string, 1001), invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeCreationGroups(tc.input)
			if (err != nil) != tc.invalid || err == nil && !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("groups=%v err=%v, want=%v invalid=%v", got, err, tc.want, tc.invalid)
			}
		})
	}
}

func TestCreateUserWithGroups(t *testing.T) {
	pool := emailDatabase(t)
	service := NewService(pool, nil, "http://localhost")
	actor, err := service.insertUser(t.Context(), "Administrator", "actor@example.com", "admin", "")
	if err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	service.RegisterAdmin(router)
	makeGroup := func(name string, parent *string, deleted bool) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(t.Context(), `INSERT INTO groups(name, parent_id, deleted_at) VALUES ($1, $2, CASE WHEN $3 THEN now() END) RETURNING id`, name, parent, deleted).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	parent := makeGroup("Parent", nil, false)
	child := makeGroup("Child", &parent, false)
	other := makeGroup("Other", nil, false)
	deleted := makeGroup("Deleted", nil, true)
	if _, err := pool.Exec(t.Context(), `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, child, actor.ID); err != nil {
		t.Fatal(err)
	}

	call := func(input map[string]any, currentActor string, status int, code string) User {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), userContextKey{}, User{ID: currentActor, Role: "admin"}))
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != status {
			t.Fatalf("status=%d want=%d body=%s", response.Code, status, response.Body.String())
		}
		if code != "" && !strings.Contains(response.Body.String(), `"code":"`+code+`"`) {
			t.Fatalf("unexpected error: %s", response.Body.String())
		}
		var user User
		if status == http.StatusCreated {
			if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil {
				t.Fatal(err)
			}
		}
		return user
	}
	for _, tc := range []struct {
		name   string
		groups any
		omit   bool
		role   string
	}{
		{name: "omitted", omit: true, role: "user"},
		{name: "empty", groups: []string{}, role: "user"},
		{name: "null", groups: nil, role: "user"},
		{name: "multiple", groups: []string{child, other, child, strings.ToUpper(child)}, role: "user"},
		{name: "administrator", groups: []string{child}, role: "admin"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := map[string]any{"name": tc.name, "email": tc.name + "@example.com", "role": tc.role}
			if !tc.omit {
				input["group_ids"] = tc.groups
			}
			if tc.role == "admin" {
				input["password"] = "new-admin-password-123"
			}
			user := call(input, actor.ID, http.StatusCreated, "")
			var groups []string
			rows, err := pool.Query(t.Context(), `SELECT group_id::text FROM group_users WHERE user_id=$1 AND removed_at IS NULL ORDER BY group_id`, user.ID)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					t.Fatal(err)
				}
				groups = append(groups, id)
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			wantCount := 0
			if tc.name == "multiple" {
				wantCount = 2
			}
			if tc.role == "admin" {
				wantCount = 1
			}
			if len(groups) != wantCount {
				t.Fatalf("unexpected memberships: %v", groups)
			}
			for _, id := range groups {
				if id != child && id != other {
					t.Fatalf("unexpected direct membership %s", id)
				}
			}
			var wrongActors int
			if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM group_users WHERE user_id=$1 AND assigned_by_user_id<>$2`, user.ID, actor.ID).Scan(&wrongActors); err != nil || wrongActors != 0 {
				t.Fatalf("wrong assignment actor: count=%d err=%v", wrongActors, err)
			}
			if tc.role == "admin" {
				var hash string
				if err := pool.QueryRow(t.Context(), `SELECT password_hash FROM users WHERE id=$1`, user.ID).Scan(&hash); err != nil {
					t.Fatal(err)
				}
				if !verifyPassword("new-admin-password-123", hash) {
					t.Fatal("admin password was not preserved")
				}
			}
		})
	}
	for _, tc := range []struct {
		name   string
		groups any
		actor  string
		status int
		code   string
	}{
		{name: "malformed", groups: []string{"not-a-uuid"}, status: 400, code: "invalid_request"},
		{name: "not_array", groups: "bad", status: 400, code: "invalid_request"},
		{name: "root", groups: []string{rootgroup.ID}, status: 400, code: "invalid_request"},
		{name: "missing", groups: []string{child, "12345678-1234-1234-1234-123456789abc"}, status: 400, code: "invalid_request"},
		{name: "deleted", groups: []string{child, deleted}, status: 400, code: "invalid_request"},
		// An invalid actor causes a membership FK failure after CreateUser succeeds.
		{name: "membership_failure", groups: []string{child}, actor: "12345678-1234-1234-1234-123456789abc", status: 500, code: "server_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			currentActor := tc.actor
			if currentActor == "" {
				currentActor = actor.ID
			}
			email := tc.name + "@example.com"
			call(map[string]any{"name": tc.name, "email": email, "role": "user", "group_ids": tc.groups}, currentActor, tc.status, tc.code)
			var count int
			if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM users WHERE email=$1`, email).Scan(&count); err != nil || count != 0 {
				t.Fatalf("failed creation left user behind: count=%d err=%v", count, err)
			}
			if tc.name == "membership_failure" {
				// A rolled-back creation must remain retryable with the same email.
				call(map[string]any{"name": tc.name, "email": email, "role": "user", "group_ids": []string{child}}, actor.ID, http.StatusCreated, "")
			}
		})
	}
	t.Run("duplicate email remains a conflict", func(t *testing.T) {
		call(map[string]any{"name": "duplicate", "email": strings.ToUpper(actor.Email), "role": "user", "group_ids": []string{other}}, actor.ID, http.StatusConflict, "user_exists")
	})
	var preserved int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM group_users WHERE user_id=$1 AND group_id=$2 AND removed_at IS NULL`, actor.ID, child).Scan(&preserved); err != nil || preserved != 1 {
		t.Fatalf("existing membership was changed: count=%d err=%v", preserved, err)
	}
	var added int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM group_users WHERE user_id=$1 AND group_id=$2`, actor.ID, other).Scan(&added); err != nil || added != 0 {
		t.Fatalf("duplicate creation added a membership: count=%d err=%v", added, err)
	}
}
