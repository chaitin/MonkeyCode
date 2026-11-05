package endpoint

import (
	"context"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint/sqlc"
)

func cloudNames(ctx context.Context, q *sqlc.Queries, user string, rows []sqlc.Endpoint) (map[string]string, error) {
	if len(rows) == 0 {
		return nil, nil
	}
	ids := make([]string, len(rows))
	for i := range rows {
		ids[i] = rows[i].MachineID
	}
	names, err := q.CloudDeviceNames(ctx, sqlc.CloudDeviceNamesParams{UserID: user, MachineIds: ids})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]string, len(names))
	for _, row := range names {
		byID[row.MachineID] = row.Name
	}
	return byID, nil
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
