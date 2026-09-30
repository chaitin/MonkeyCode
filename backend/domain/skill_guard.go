package domain

import (
	"context"

	"github.com/google/uuid"
)

const (
	SkillGuardStatusPending     = "pending"
	SkillGuardStatusApproved    = "approved"
	SkillGuardStatusRejected    = "rejected"
	SkillGuardStatusUnavailable = "unavailable"

	SkillGuardOwnerExtensionPackage = "extension-package"
)

// SkillGuardRequest is one administrator-authored Skill package submitted to
// the static scanner. Package must contain SKILL.md at its root.
type SkillGuardRequest struct {
	Name     string
	Version  string
	Filename string
	Package  []byte
}

// SkillGuardResult is the sanitized scanner outcome. TaskID is retained for
// diagnostics and idempotent lookups; callers must not persist raw responses.
type SkillGuardResult struct {
	TaskID          string
	Status          string
	DetectionResult string
	TraceID         string
}

// SkillGuard is the fail-closed boundary used by administrator Skill writes.
type SkillGuard interface {
	Scan(ctx context.Context, req SkillGuardRequest) (*SkillGuardResult, error)
	// ScanObserved is Scan with a persistence hook invoked after the single
	// create request returns a non-terminal task. It lets the caller persist
	// the task ID before polling so a process restart can resume the same task.
	ScanObserved(ctx context.Context, req SkillGuardRequest, onTask func(*SkillGuardResult) error) (*SkillGuardResult, error)
	// Poll checks one previously-created task. A pending result is returned
	// without error so callers can persist and poll it again later.
	Poll(ctx context.Context, taskID string) (*SkillGuardResult, error)
}

// SkillGuardJob identifies a persisted pending version that must be resumed
// after a process restart. The task ID and deadline live on the version row.
type SkillGuardJob struct {
	VersionID uuid.UUID `json:"version_id"`
}
