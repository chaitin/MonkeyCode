package resource

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"
)

type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

func Users(ctx context.Context, q Queryer, ids []string) (map[string]User, error) {
	users := make(map[string]User, len(ids))
	if len(ids) == 0 {
		return users, nil
	}
	rows, err := sqlc.New(q).ListOwners(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		users[row.ID] = User{ID: row.ID, Name: row.Name, Email: row.Email}
	}
	return users, nil
}
