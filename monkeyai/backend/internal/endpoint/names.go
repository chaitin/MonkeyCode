package endpoint

import (
	"context"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type nameReader func(context.Context, resource.Queryer, string, []string) (map[string]string, error)

func (read nameReader) lookup(ctx context.Context, db resource.Queryer, user string, rows []sqlc.Endpoint) (map[string]string, error) {
	if read == nil || len(rows) == 0 {
		return nil, nil
	}
	ids := make([]string, len(rows))
	for i, row := range rows {
		ids[i] = row.MachineID
	}
	return read(ctx, db, user, ids)
}

func displayName(row sqlc.Endpoint, names map[string]string) string {
	if row.Alias != nil {
		return *row.Alias
	}
	if name := names[row.MachineID]; name != "" {
		return name
	}
	return row.DeviceName
}

func namedEndpoint(row sqlc.Endpoint, names map[string]string) Endpoint {
	out := fromRow(row)
	out.DisplayName = displayName(row, names)
	return out
}
