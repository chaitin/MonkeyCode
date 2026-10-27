package endpoint

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DeviceAuthorizer interface {
	BindDevice(context.Context, pgx.Tx, identity.Principal, string, string) (bool, error)
	ConsumeRuntimeRestore(context.Context, pgx.Tx, identity.Principal) (bool, error)
	RevokeRuntimeGrant(context.Context, pgx.Tx, string, string, string) (bool, error)
	NotifyGrantRevoked(string)
	AuthorizeDevice(context.Context, pgx.Tx, identity.Principal, string) (bool, error)
}

type Execution struct {
	pool *pgxpool.Pool
	auth DeviceAuthorizer
}

func NewExecution(pool *pgxpool.Pool, auth DeviceAuthorizer) *Execution {
	return &Execution{pool: pool, auth: auth}
}

type Enrollment struct {
	Protocols      map[string][]int
	RuntimeVersion string
	EngineVersion  string
	MachineID      string
	PublicKey      []byte
	DisplayName    string
	Platform       string
	Arch           string
	Intent         string
	DeploymentMode string
	RestoreRevoked bool
}

type ExecutionState struct {
	Protocols           map[string][]int
	LastSeenAt          *time.Time
	RuntimeVersion      *string
	EngineVersion       *string
	MachineID           string
	DisplayName         string
	Platform            string
	Arch                string
	PublicKey           []byte
	KeyID               string
	RemoteAccessState   string
	DeploymentMode      string
	ActiveGrantID       string
	RegistrationVersion int64
	GrantVersion        int64
	LeaseEpoch          int64
}

func executionState(row sqlc.Endpoint) ExecutionState {
	out := ExecutionState{MachineID: row.MachineID, DisplayName: row.DeviceName, Platform: row.Platform, Arch: row.Arch,
		PublicKey: slices.Clone(row.ExecutionPublicKey), RemoteAccessState: row.RemoteAccessState,
		RegistrationVersion: row.RegistrationVersion, GrantVersion: row.GrantVersion, LeaseEpoch: row.LeaseEpoch,
		LastSeenAt: row.LastSeenAt, RuntimeVersion: row.RuntimeVersion, EngineVersion: row.EngineVersion}
	if err := json.Unmarshal(row.ExecutionProtocols, &out.Protocols); err != nil {
		slog.Error("解析数据失败", "module", "endpoint", "operation", "executionState", "error", err)
	}
	if row.Alias != nil {
		out.DisplayName = *row.Alias
	}
	if row.KeyID != nil {
		out.KeyID = *row.KeyID
	}
	if row.DeploymentMode != nil {
		out.DeploymentMode = *row.DeploymentMode
	}
	if row.ActiveGrantID != nil {
		out.ActiveGrantID = *row.ActiveGrantID
	}
	return out
}

func executionFailure(status int, code string) error {
	messages := map[string]string{
		"invalid_request": "设备证明参数无效", "permission_denied": "设备授权不包含所需权限",
		"device_not_found": "设备不存在", "device_revoked": "远程访问已撤销",
		"device_registration_conflict": "设备公钥或授权绑定冲突", "device_registration_changed": "设备登记版本已变化，请重新证明",
	}
	return &resource.Error{Status: status, Code: code, Message: messages[code]}
}

func (e *Execution) Snapshot(ctx context.Context, userID string, executeOnly bool) ([]ExecutionState, error) {
	rows, err := sqlc.New(e.pool).ListExecutions(ctx, sqlc.ListExecutionsParams{UserID: userID, ExecuteOnly: executeOnly})
	if err != nil {
		return nil, err
	}
	out := make([]ExecutionState, 0, len(rows))
	for _, row := range rows {
		out = append(out, executionState(row))
	}
	return out, nil
}

func (e *Execution) ReadState(ctx context.Context, tx pgx.Tx, userID, machineID string) (ExecutionState, error) {
	row, err := sqlc.New(tx).Get(ctx, sqlc.GetParams{UserID: userID, MachineID: machineID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ExecutionState{}, executionFailure(404, "device_not_found")
	}
	return executionState(row), err
}

func (e *Execution) State(ctx context.Context, userID, machineID string) (ExecutionState, error) {
	row, err := sqlc.New(e.pool).Get(ctx, sqlc.GetParams{UserID: userID, MachineID: machineID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ExecutionState{}, executionFailure(http.StatusNotFound, "device_not_found")
	}
	return executionState(row), err
}

func KeyID(key []byte) string {
	digest := sha256.Sum256(key)
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (e *Execution) VerifyDeviceRequest(ctx context.Context, tx pgx.Tx, user, machine string, public []byte) (bool, error) {
	row, err := sqlc.New(tx).Get(ctx, sqlc.GetParams{UserID: user, MachineID: machine})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if len(row.ExecutionPublicKey) > 0 && !bytes.Equal(row.ExecutionPublicKey, public) {
		return false, identity.ErrDeviceBindingConflict
	}
	return row.RemoteAccessState == "revoked" || row.Status == "revoked", nil
}

func (e *Execution) Enroll(ctx context.Context, p identity.Principal, in Enrollment, version int64) (ExecutionState, error) {
	if !validID(in.MachineID) || len(in.PublicKey) != ed25519.PublicKeySize || !text(in.DisplayName, 128) || !text(in.Arch, 32) ||
		!slices.Contains([]string{"macos", "windows", "linux"}, in.Platform) || !slices.Contains([]string{"publish", "bind_identity"}, in.Intent) {
		return ExecutionState{}, executionFailure(http.StatusBadRequest, "invalid_request")
	}
	managed := p.ClientID == "monkeyai-desktop" && p.Purpose == "user" && in.DeploymentMode == "desktop_managed"
	standalone := p.ClientID == identity.RuntimeClientID && p.Purpose == "runtime" && in.DeploymentMode == "standalone"
	if !p.Has("device:bind") || (in.Intent == "publish" && (!p.Has("device:publish") || !managed && !standalone)) {
		return ExecutionState{}, executionFailure(http.StatusForbidden, "permission_denied")
	}
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return ExecutionState{}, err
	}
	defer rollback(context.WithoutCancel(ctx), tx, p.UserID, "execution_enroll")
	q := sqlc.New(tx)
	if _, err := q.LockUser(ctx, p.UserID); err != nil {
		return ExecutionState{}, err
	}
	old, err := q.Get(ctx, sqlc.GetParams{UserID: p.UserID, MachineID: in.MachineID})
	fresh := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !fresh {
		return ExecutionState{}, err
	}
	if fresh {
		if version != 0 {
			return ExecutionState{}, executionFailure(http.StatusConflict, "device_registration_changed")
		}
		if err := limit(ctx, q, p.UserID, 20); err != nil {
			return ExecutionState{}, err
		}
		if err := q.EnsureExecutionEndpoint(ctx, sqlc.EnsureExecutionEndpointParams{UserID: p.UserID, MachineID: in.MachineID, DeviceName: in.DisplayName, Platform: in.Platform, Arch: in.Arch}); err != nil {
			return ExecutionState{}, err
		}
		old, err = q.Get(ctx, sqlc.GetParams{UserID: p.UserID, MachineID: in.MachineID})
		if err != nil {
			return ExecutionState{}, err
		}
	}
	if old.RegistrationVersion != version {
		return ExecutionState{}, executionFailure(http.StatusConflict, "device_registration_changed")
	}
	if len(old.ExecutionPublicKey) > 0 && !bytes.Equal(old.ExecutionPublicKey, in.PublicKey) {
		return ExecutionState{}, executionFailure(http.StatusConflict, "device_registration_conflict")
	}
	if in.Intent == "publish" && (old.RemoteAccessState == "revoked" || old.Status == "revoked") && !in.RestoreRevoked {
		return ExecutionState{}, executionFailure(http.StatusForbidden, "device_revoked")
	}
	valid, err := e.auth.BindDevice(ctx, tx, p, in.MachineID, KeyID(in.PublicKey))
	if errors.Is(err, identity.ErrDeviceBindingConflict) {
		return ExecutionState{}, executionFailure(http.StatusConflict, "device_registration_conflict")
	}
	if err != nil {
		return ExecutionState{}, err
	}
	if !valid {
		return ExecutionState{}, executionFailure(http.StatusForbidden, "permission_denied")
	}
	if in.Intent == "publish" && standalone && (old.RemoteAccessState == "revoked" || old.Status == "revoked") {
		approved, err := e.auth.ConsumeRuntimeRestore(ctx, tx, p)
		if err != nil {
			return ExecutionState{}, err
		}
		if !approved {
			return ExecutionState{}, executionFailure(403, "device_revoked")
		}
	}
	row, err := q.SetExecutionIdentity(ctx, sqlc.SetExecutionIdentityParams{UserID: p.UserID, MachineID: in.MachineID,
		ExecutionPublicKey: in.PublicKey, KeyID: new(KeyID(in.PublicKey)), RegistrationVersion: version})
	if errors.Is(err, pgx.ErrNoRows) {
		return ExecutionState{}, executionFailure(http.StatusConflict, "device_registration_changed")
	}
	if err != nil {
		return ExecutionState{}, err
	}
	revokedGrant := ""
	if in.Intent == "publish" {
		if old.ActiveGrantID != nil && *old.ActiveGrantID != p.GrantID {
			revoked, err := e.auth.RevokeRuntimeGrant(ctx, tx, p.UserID, in.MachineID, *old.ActiveGrantID)
			if err != nil {
				return ExecutionState{}, err
			}
			if revoked {
				revokedGrant = *old.ActiveGrantID
			}
		}
		protocols, err := json.Marshal(in.Protocols)
		if err != nil {
			return ExecutionState{}, err
		}
		if in.Protocols == nil {
			protocols = []byte("{}")
		}
		row, err = q.EnableExecution(ctx, sqlc.EnableExecutionParams{UserID: p.UserID, MachineID: in.MachineID, ActiveGrantID: new(p.GrantID), DeploymentMode: new(in.DeploymentMode), ExecutionProtocols: protocols, RuntimeVersion: new(in.RuntimeVersion), EngineVersion: new(in.EngineVersion)})
		if err != nil {
			return ExecutionState{}, err
		}
	}
	if fresh || len(old.ExecutionPublicKey) == 0 || in.Intent == "publish" && old.GrantVersion != row.GrantVersion {
		if err := audit.Write(ctx, tx, audit.Event{ActorID: p.UserID, Action: "endpoint." + in.Intent, Category: "security", TargetType: "endpoint", TargetID: row.ID,
			Params: map[string]any{"machine_id": in.MachineID, "registration_version": row.RegistrationVersion, "grant_version": row.GrantVersion}}); err != nil {
			return ExecutionState{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ExecutionState{}, err
	}
	if revokedGrant != "" {
		e.auth.NotifyGrantRevoked(revokedGrant)
	}
	return executionState(row), nil
}

func (e *Execution) AuthenticateHost(ctx context.Context, tx pgx.Tx, p identity.Principal, machineID string) (bool, error) {
	q := sqlc.New(tx)
	if _, err := q.LockUser(ctx, p.UserID); err != nil {
		return false, err
	}
	scope := ""
	if len(p.Scopes) > 0 {
		if !p.Has("session:report") {
			return false, executionFailure(http.StatusForbidden, "permission_denied")
		}
		if p.MachineID == "" {
			return false, &resource.Error{Status: http.StatusForbidden, Code: "device_identity_required", Message: "需要先证明本机身份"}
		}
		scope = "session:report"
	}
	valid, err := e.auth.AuthorizeDevice(ctx, tx, p, scope)
	if err != nil {
		return false, err
	}
	if !valid {
		return false, executionFailure(http.StatusForbidden, "permission_denied")
	}
	row, err := q.Get(ctx, sqlc.GetParams{UserID: p.UserID, MachineID: machineID})
	if errors.Is(err, pgx.ErrNoRows) && len(p.Scopes) == 0 {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if len(p.Scopes) == 0 && row.KeyID == nil {
		return false, nil
	}
	if p.MachineID != machineID || row.KeyID == nil || p.KeyID != *row.KeyID {
		return false, &resource.Error{Status: http.StatusForbidden, Code: "device_identity_required", Message: "已验证设备不能使用自报身份上报"}
	}
	return true, nil
}

func (e *Execution) Revoke(ctx context.Context, p identity.Principal, machineID string, version int64) (ExecutionState, error) {
	if !p.Has("device:manage") {
		return ExecutionState{}, executionFailure(http.StatusForbidden, "permission_denied")
	}
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		return ExecutionState{}, err
	}
	defer rollback(context.WithoutCancel(ctx), tx, p.UserID, "execution_revoke")
	q := sqlc.New(tx)
	if _, err := q.LockUser(ctx, p.UserID); err != nil {
		return ExecutionState{}, err
	}
	valid, err := e.auth.AuthorizeDevice(ctx, tx, p, "device:manage")
	if err != nil {
		return ExecutionState{}, err
	}
	if !valid {
		return ExecutionState{}, executionFailure(http.StatusForbidden, "permission_denied")
	}
	old, err := q.Get(ctx, sqlc.GetParams{UserID: p.UserID, MachineID: machineID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ExecutionState{}, executionFailure(http.StatusNotFound, "device_not_found")
	}
	if err != nil {
		return ExecutionState{}, err
	}
	if old.RegistrationVersion != version && !(old.RemoteAccessState == "revoked" && old.RegistrationVersion == version+1) {
		return ExecutionState{}, executionFailure(http.StatusPreconditionFailed, "device_registration_changed")
	}
	if old.DeploymentMode != nil && *old.DeploymentMode == "standalone" && old.ActiveGrantID != nil {
		if _, err := e.auth.RevokeRuntimeGrant(ctx, tx, p.UserID, machineID, *old.ActiveGrantID); err != nil {
			return ExecutionState{}, err
		}
	}
	row, err := q.RevokeExecution(ctx, sqlc.RevokeExecutionParams{UserID: p.UserID, MachineID: machineID})
	if err != nil {
		return ExecutionState{}, err
	}
	if old.RemoteAccessState != "revoked" {
		if err := audit.Write(ctx, tx, audit.Event{ActorID: p.UserID, Action: "endpoint.execution_revoke", Category: "security", TargetType: "endpoint", TargetID: row.ID,
			Params: map[string]string{"machine_id": machineID}}); err != nil {
			return ExecutionState{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return ExecutionState{}, err
	}
	if old.DeploymentMode != nil && *old.DeploymentMode == "standalone" && old.ActiveGrantID != nil {
		e.auth.NotifyGrantRevoked(*old.ActiveGrantID)
	}
	return executionState(row), nil
}
