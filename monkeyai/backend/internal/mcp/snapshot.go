package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/jackc/pgx/v5"
)

func snapshotTime() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }

func syncedAt(c, cred resource.Object) time.Time {
	if cred != nil {
		c = cred
	}
	t, _ := time.Parse(time.RFC3339Nano, c.String("tools_synced_at"))
	return t
}

func (s *Service) cachedTools(ctx context.Context, q resource.Queryer, c, cred, _ resource.Object) ([]resource.Object, error) {
	at := syncedAt(c, cred)
	if at.IsZero() {
		return []resource.Object{}, nil
	}
	return resource.DecodeObjects(sqlc.New(q).ListSnapshotTools(ctx, sqlc.ListSnapshotToolsParams{
		ConnectorID: c.String("id"), CredentialID: cred.String("id"), ConfigRevision: c.Int("config_revision"), SyncedAt: at,
		Independent: c.String("authorization_mode") == "independent",
	}))
}

func (s *Service) discoverTools(ctx context.Context, c, cred resource.Object) ([]remoteTool, error) {
	headers, _, err := s.headers(ctx, c, cred)
	if err != nil {
		return nil, err
	}
	h, err := s.clientFor(ctx, c)
	if err != nil {
		return nil, err
	}
	setConnectorTimeout(h, c.Int("timeout_ms"))
	tools, err := discoverWithClient(ctx, c.String("url"), headers, h)
	if err != nil {
		return nil, upstreamFailure(err, "mcp_protocol_invalid")
	}
	return tools, nil
}

func snapshotDenied(err error) bool {
	var fault *resource.Error
	return errors.As(err, &fault) && (fault.Code == "mcp_upstream_unauthorized" || fault.Code == "mcp_upstream_forbidden")
}

func saveSnapshot(ctx context.Context, q *sqlc.Queries, c, cred resource.Object, started time.Time, tools []remoteTool, invalidate bool) error {
	if !started.After(syncedAt(c, cred)) {
		return nil
	}
	var at *time.Time
	if !invalidate {
		at = &started
		if len(tools) > 0 {
			items := make([]struct {
				ID string `json:"id"`
				remoteTool
			}, len(tools))
			for i, tool := range tools {
				items[i].ID, items[i].remoteTool = toolID(c, cred, tool.Name), tool
			}
			data, err := json.Marshal(items)
			if err != nil {
				return err
			}
			if err = q.SaveSnapshotTools(ctx, sqlc.SaveSnapshotToolsParams{
				ConnectorID: c.String("id"), CredentialID: cred.String("id"), ConfigRevision: c.Int("config_revision"), SyncedAt: started, Tools: data,
			}); err != nil {
				return err
			}
		}
	}
	if cred != nil {
		return q.SetCredentialToolsSynced(ctx, sqlc.SetCredentialToolsSyncedParams{ID: cred.String("id"), SyncedAt: at})
	}
	return q.SetConnectorToolsSynced(ctx, sqlc.SetConnectorToolsSyncedParams{ID: c.String("id"), SyncedAt: at})
}

func (s *Service) storeTools(ctx context.Context, c, cred resource.Object, started time.Time, tools []remoteTool, invalidate bool) error {
	tx, err := s.Store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackMCP(ctx, tx, c.String("id"), cred.String("id"), "snapshot")
	q := sqlc.New(tx)
	current, err := resource.DecodeObject(q.LockConnector(ctx, c.String("id")))
	if errors.Is(err, pgx.ErrNoRows) || err == nil && current.Int("config_revision") != c.Int("config_revision") {
		return nil
	}
	if err != nil {
		return err
	}
	var fresh resource.Object
	if cred != nil {
		fresh, err = resource.DecodeObject(q.LockCredential(ctx, cred.String("id")))
		if errors.Is(err, pgx.ErrNoRows) || err == nil && (fresh.Int("revision") != cred.Int("revision") || credentialStatus(current, fresh) != "authorized") {
			return nil
		}
		if err != nil {
			return err
		}
	}
	if syncedAt(current, fresh).IsZero() && !syncedAt(c, cred).IsZero() {
		return nil
	}
	if err = saveSnapshot(ctx, q, current, fresh, started, tools, invalidate); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) recordTools(ctx context.Context, c, cred resource.Object, started time.Time, tools []remoteTool, invalidate bool) {
	if err := s.storeTools(ctx, c, cred, started, tools, invalidate); err != nil && ctx.Err() == nil {
		logging.Event(ctx, slog.Default(), slog.LevelWarn, "mcp.tools.snapshot.failed", "保存 MCP 工具快照失败",
			"connector_id", c.String("id"), "credential_id", cred.String("id"), "error", err)
	}
}
