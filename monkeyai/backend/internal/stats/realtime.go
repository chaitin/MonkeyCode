package stats

import (
	"context"
	"strconv"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/stats/sqlc"

	"github.com/jackc/pgx/v5"
)

func realtime(ctx context.Context, tx pgx.Tx, w window) (resource.Object, error) {
	return resource.DecodeObject(sqlc.New(tx).Realtime(ctx, sqlc.RealtimeParams{
		FromTime:      w.from,
		UntilTime:     w.until,
		WindowMinutes: strconv.FormatFloat(w.until.Sub(w.from).Minutes(), 'f', -1, 64),
	}))
}
