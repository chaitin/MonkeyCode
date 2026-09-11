package domain

import "context"

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
}
