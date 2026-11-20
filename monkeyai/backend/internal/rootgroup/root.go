package rootgroup

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
)

const ID = "00000000-0000-0000-0000-000000000000"

type BrandingReader interface {
	GetValue(context.Context, string) (json.RawMessage, error)
}
type nameKey struct{}
type resolvedName struct {
	name string
	err  error
}

func Middleware(reader BrandingReader) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			value := resolvedName{name: "Monkey AI"}
			if reader != nil {
				raw, err := reader.GetValue(r.Context(), "branding")
				value.err = err
				if err == nil {
					var branding struct {
						WorkspaceName string `json:"workspace_name"`
					}
					value.err = json.Unmarshal(raw, &branding)
					if name := strings.TrimSpace(branding.WorkspaceName); name != "" {
						value.name = name
					}
				}
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), nameKey{}, value)))
		})
	}
}
func Name(ctx context.Context, _ *pgxpool.Pool) (string, error) {
	value, ok := ctx.Value(nameKey{}).(resolvedName)
	if !ok {
		return "Monkey AI", nil
	}
	return value.name, value.err
}

func DirectMemberIDs(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	return sqlc.New(pool).RootDirectMemberIDs(ctx)
}

func UserGroups(ctx context.Context, pool *pgxpool.Pool) (map[string]string, error) {
	rows, err := sqlc.New(pool).RootUserGroups(ctx, ID)
	if err != nil {
		return nil, err
	}
	groups := make(map[string]string, len(rows))
	for _, row := range rows {
		groups[row.UserID] = row.GroupID
	}
	return groups, nil
}

func ParentID(parent *string) *string {
	if parent == nil {
		id := ID
		return &id
	}
	return parent
}
