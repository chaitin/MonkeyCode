// Package usecase — 团队管理员侧 skill 的业务逻辑:zip 校验 + OSS 上传 +
// agent_skill upsert + new version + group binding 替换。D3 语义:Content
// 非空 → 新版本;只改元数据 → mutate 行。
package usecase

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/agentresource"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/aiguard"
	"github.com/chaitin/MonkeyCode/backend/pkg/auditmeta"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
)

// skillS3KeyPrefix:S3 上每个 skill 版本对应的 key 形如
//
//	agent-resources/skills/team/<team_id>/<skill_id>/<version>.zip
const skillS3KeyPrefix = "agent-resources/skills/team"

const (
	defaultGuardWaitTimeout = 10 * time.Minute
	guardRecoveryInterval   = 5 * time.Second
)

type teamSkillUsecase struct {
	repo             domain.TeamSkillRepo
	objstore         agentresource.ObjectStore
	guard            domain.SkillGuard
	queue            *delayqueue.SkillGuardQueue
	stageFinalizer   domain.ExtensionPackageStageFinalizer
	logger           *slog.Logger
	guardWaitTimeout time.Duration
}

func NewTeamSkillUsecase(i *do.Injector) (domain.TeamSkillUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	u := &teamSkillUsecase{
		repo:             do.MustInvoke[domain.TeamSkillRepo](i),
		objstore:         do.MustInvoke[agentresource.ObjectStore](i),
		guard:            aiguard.NewClient(cfg.AIGuard),
		queue:            do.MustInvoke[*delayqueue.SkillGuardQueue](i),
		stageFinalizer:   do.MustInvoke[domain.ExtensionPackageStageFinalizer](i),
		guardWaitTimeout: positiveDuration(cfg.AIGuard.WaitTimeout, defaultGuardWaitTimeout),
		logger:           do.MustInvoke[*slog.Logger](i),
	}
	if u.queue != nil {
		go u.runGuardConsumer()
	}
	return u, nil
}

func (u *teamSkillUsecase) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamSkillsResp, error) {
	skills, err := u.repo.List(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	out := make([]*domain.TeamSkill, 0, len(skills))
	for _, s := range skills {
		ts, err := u.skillToDTO(ctx, s)
		if err != nil {
			return nil, err
		}
		out = append(out, ts)
	}
	return &domain.ListTeamSkillsResp{Skills: out}, nil
}

func (u *teamSkillUsecase) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamSkillReq) (*domain.TeamSkill, error) {
	// JSON 入口:把 Content (SKILL.md 文本) 打成单文件 zip,再走 AddPackage 路径。
	data, err := packageSkillMarkdownContent(req.Content)
	if err != nil {
		return nil, err
	}
	pkg := &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: *req,
		PackageFilename: skillPackageFilename(req.Name),
		PackageData:     data,
	}
	return u.AddPackage(ctx, teamUser, pkg)
}

func (u *teamSkillUsecase) AddPackage(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamSkillPackageReq) (*domain.TeamSkill, error) {
	teamID := teamUser.GetTeamID()
	userID := teamUser.User.ID

	frontmatterTags, err := validateSkillZipPackage(req.PackageData)
	if err != nil {
		return nil, err
	}

	// tags 优先级:form 字段 present → 覆盖;absent → 用 frontmatter 解析出来的
	tags := req.Tags
	if tags == nil {
		tags = frontmatterTags
	}

	if req.GuardChecked {
		pendingGuard := strings.TrimSpace(req.GuardTaskID) != "" || !req.GuardDeadline.IsZero() || strings.TrimSpace(req.GuardStageKey) != ""
		staged, err := u.stageVersion(ctx, teamID, userID, req, tags, !pendingGuard, req.GuardTaskID, req.GuardDeadline)
		if err != nil {
			return nil, err
		}
		if pendingGuard {
			if err := u.enqueueGuardJob(ctx, staged.versionID, time.Now()); err != nil {
				return nil, err
			}
		}
		return u.loadDTO(ctx, teamID, staged.skillID)
	}

	var pending *stagedSkillVersion
	result, err := u.guard.ScanObserved(ctx, domain.SkillGuardRequest{
		Name:     req.Name,
		Filename: req.PackageFilename,
		Package:  req.PackageData,
	}, func(task *domain.SkillGuardResult) error {
		deadline := time.Now().Add(u.waitTimeout())
		staged, stageErr := u.stageVersion(ctx, teamID, userID, req, tags, false, task.TaskID, deadline)
		if stageErr != nil {
			return stageErr
		}
		pending = staged
		return u.enqueueGuardJob(ctx, staged.versionID, time.Now())
	})
	auditmeta.SetGuardResult(ctx, result)
	if err != nil {
		if pending != nil && !isRequestCancellation(err) {
			if rejectErr := u.rejectPending(context.WithoutCancel(ctx), pending, err); rejectErr != nil {
				u.logger.ErrorContext(ctx, "failed to persist rejected skill scan", "skill_id", pending.skillID, "version_id", pending.versionID, "error", rejectErr)
			}
		}
		return nil, err
	}

	if pending == nil {
		staged, err := u.stageVersion(ctx, teamID, userID, req, tags, true, "", time.Time{})
		if err != nil {
			return nil, err
		}
		return u.loadDTO(ctx, teamID, staged.skillID)
	}
	if err := u.approvePending(ctx, teamID, pending); err != nil {
		return nil, err
	}
	return u.loadDTO(ctx, teamID, pending.skillID)
}

func isRequestCancellation(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

func (u *teamSkillUsecase) ApproveGuardStage(ctx context.Context, teamID uuid.UUID, stageKey string) error {
	stageKey = strings.TrimSpace(stageKey)
	if stageKey == "" {
		return fmt.Errorf("approve guard stage: empty stage key")
	}
	versions, err := u.pendingGuardStageVersions(ctx, stageKey)
	if err != nil {
		return err
	}
	if _, err := u.repo.ApproveGuardStage(ctx, teamID, stageKey); err != nil {
		return err
	}
	for _, version := range versions {
		u.removeGuardJob(ctx, version.ID)
	}
	return nil
}

func (u *teamSkillUsecase) RejectGuardStage(ctx context.Context, stageKey string, scanErr error) error {
	stageKey = strings.TrimSpace(stageKey)
	if stageKey == "" {
		return fmt.Errorf("reject guard stage: empty stage key")
	}
	status := domain.SkillGuardStatusUnavailable
	reason := "security scan unavailable or did not complete"
	if errors.Is(scanErr, aiguard.ErrRejected) {
		status = domain.SkillGuardStatusRejected
		reason = "security scan rejected the package"
	}
	versions, err := u.pendingGuardStageVersions(ctx, stageKey)
	if err != nil {
		return err
	}
	if _, err := u.repo.RejectGuardStage(ctx, stageKey, status, reason); err != nil {
		return err
	}
	for _, version := range versions {
		u.removeGuardJob(ctx, version.ID)
	}
	return nil
}

func (u *teamSkillUsecase) pendingGuardStageVersions(ctx context.Context, stageKey string) ([]*db.AgentSkillVersion, error) {
	versions, err := u.repo.ListPendingGuardVersions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*db.AgentSkillVersion, 0)
	for _, version := range versions {
		if version.ParsedMeta.PendingGuardOwner != domain.SkillGuardOwnerExtensionPackage {
			continue
		}
		if version.ParsedMeta.PendingStageKey != stageKey {
			continue
		}
		out = append(out, version)
	}
	return out, nil
}

func (u *teamSkillUsecase) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamSkillReq) (*domain.TeamSkill, error) {
	teamID := teamUser.GetTeamID()

	// D3:Content 非空 → 内容变更 → 新版本;否则只改元数据。
	if strings.TrimSpace(req.Content) != "" {
		// 走 Add 同款流程:打包 + upload + new version
		data, err := packageSkillMarkdownContent(req.Content)
		if err != nil {
			return nil, err
		}
		// 先 load skill 拿 name(name 不允许改);再走 AddPackage
		skills, err := u.repo.List(ctx, teamID)
		if err != nil {
			return nil, err
		}
		var existing *db.AgentSkill
		for _, s := range skills {
			if s.ID == req.SkillID {
				existing = s
				break
			}
		}
		if existing == nil {
			return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("skill not found"))
		}
		pkg := &domain.AddTeamSkillPackageReq{
			AddTeamSkillReq: domain.AddTeamSkillReq{
				Name:            existing.Name,
				Description:     strDerefOr(req.Description, existing.Description),
				Tags:            req.Tags,
				Content:         req.Content,
				GroupIDs:        req.GroupIDs,
				SkillMDPath:     strDeref(req.SkillMDPath),
				IsForceDelivery: boolDeref(req.IsForceDelivery, existing.IsForceDelivery),
				SourceType:      strDeref(req.SourceType),
				SourceLabel:     strDeref(req.SourceLabel),
			},
			PackageFilename: skillPackageFilename(existing.Name),
			PackageData:     data,
		}
		return u.AddPackage(ctx, teamUser, pkg)
	}

	// 仅 metadata 更新(name / description / is_force_delivery)
	if _, err := u.repo.UpdateMeta(ctx, teamID, req.SkillID, req.Name, req.Description, req.IsForceDelivery); err != nil {
		return nil, err
	}
	// tags 存在 active version 的 parsed_meta 上,原地更新(不建新版本)。
	if req.Tags != nil {
		if err := u.repo.UpdateActiveVersionTags(ctx, req.SkillID, req.Tags); err != nil {
			return nil, err
		}
	}
	if req.GroupIDs != nil {
		if err := u.repo.ReplaceGroupBindings(ctx, teamID, req.SkillID, req.GroupIDs); err != nil {
			return nil, err
		}
	}
	return u.loadDTO(ctx, teamID, req.SkillID)
}

func (u *teamSkillUsecase) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamSkillReq) error {
	return u.repo.SoftDeleteSkill(ctx, teamUser.GetTeamID(), req.SkillID)
}

type stagedSkillVersion struct {
	skillID   uuid.UUID
	versionID uuid.UUID
	groupIDs  []uuid.UUID
}

func (u *teamSkillUsecase) waitTimeout() time.Duration {
	if u.guardWaitTimeout > 0 {
		return u.guardWaitTimeout
	}
	return defaultGuardWaitTimeout
}

func positiveDuration(raw string, fallback time.Duration) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

func (u *teamSkillUsecase) stageVersion(ctx context.Context, teamID, userID uuid.UUID, req *domain.AddTeamSkillPackageReq, tags []string, active bool, taskID string, deadline time.Time) (*stagedSkillVersion, error) {
	repoID, err := u.repo.GetBareRepoID(ctx, teamID)
	if err != nil {
		return nil, err
	}
	skill, err := u.repo.UpsertSkill(ctx, teamID, repoID, userID, req.Name, req.Description, req.IsForceDelivery, req.ExtensionPackageID)
	if err != nil {
		return nil, err
	}
	nextVer, err := u.repo.NextVersionFor(ctx, skill.ID)
	if err != nil {
		return nil, err
	}
	s3Key := fmt.Sprintf("%s/%s/%s/%s.zip", skillS3KeyPrefix, teamID.String(), skill.ID.String(), nextVer)
	prefix, filename := path.Split(s3Key)
	if err := u.objstore.PutFile(ctx, strings.TrimSuffix(prefix, "/"), filename, bytes.NewReader(req.PackageData)); err != nil {
		return nil, err
	}
	meta := domain.SkillVersionMeta{
		Description:            req.Description,
		Tags:                   tags,
		PendingGuardOwner:      req.PendingGuardOwner,
		PendingStageKey:        req.GuardStageKey,
		PendingPackageFilename: req.PendingPackageFilename,
		PendingPackageVersion:  req.PendingPackageVersion,
		// Categories: 当前 frontmatter 解析不暴露,留空。
		SourceType:  req.SourceType,
		SourceLabel: req.SourceLabel,
	}

	var version *db.AgentSkillVersion
	if active {
		version, err = u.repo.CreateVersion(ctx, skill.ID, nextVer, s3Key, meta)
	} else {
		version, err = u.repo.CreatePendingVersion(ctx, skill.ID, nextVer, s3Key, meta, req.GroupIDs, taskID, deadline)
	}
	if err != nil {
		return nil, err
	}
	if active {
		if err := u.repo.ReplaceGroupBindings(ctx, teamID, skill.ID, req.GroupIDs); err != nil {
			return nil, err
		}
	}
	return &stagedSkillVersion{skillID: skill.ID, versionID: version.ID, groupIDs: req.GroupIDs}, nil
}

func (u *teamSkillUsecase) approvePending(ctx context.Context, teamID uuid.UUID, staged *stagedSkillVersion) error {
	if staged == nil {
		return fmt.Errorf("approve pending guard: missing staged version")
	}
	if err := u.repo.ApproveVersion(ctx, teamID, staged.skillID, staged.versionID, staged.groupIDs); err != nil {
		return err
	}
	u.removeGuardJob(ctx, staged.versionID)
	return nil
}

func (u *teamSkillUsecase) rejectPending(ctx context.Context, staged *stagedSkillVersion, scanErr error) error {
	if staged == nil {
		return nil
	}
	status := domain.SkillGuardStatusUnavailable
	if errors.Is(scanErr, aiguard.ErrRejected) {
		status = domain.SkillGuardStatusRejected
	}
	reason := "security scan unavailable or did not complete"
	if status == domain.SkillGuardStatusRejected {
		reason = "security scan rejected the package"
	}
	if err := u.repo.RejectVersion(ctx, staged.versionID, status, reason); err != nil {
		return err
	}
	u.removeGuardJob(ctx, staged.versionID)
	return nil
}

func (u *teamSkillUsecase) enqueueGuardJob(ctx context.Context, versionID uuid.UUID, runAt time.Time) error {
	if u.queue == nil {
		return nil
	}
	_, err := u.queue.Enqueue(ctx, consts.SkillGuardQueueKey, &domain.SkillGuardJob{VersionID: versionID}, runAt, versionID.String())
	return err
}

func (u *teamSkillUsecase) enqueueGuardJobIfMissing(ctx context.Context, versionID uuid.UUID, runAt time.Time) error {
	if u.queue == nil {
		return nil
	}
	_, _, err := u.queue.EnqueueIfMissing(ctx, consts.SkillGuardQueueKey, &domain.SkillGuardJob{VersionID: versionID}, runAt, versionID.String())
	return err
}

func (u *teamSkillUsecase) removeGuardJob(ctx context.Context, versionID uuid.UUID) {
	if u.queue == nil {
		return
	}
	if err := u.queue.Remove(ctx, consts.SkillGuardQueueKey, versionID.String()); err != nil && !errors.Is(err, context.Canceled) {
		u.logger.WarnContext(ctx, "failed to remove completed skill guard recovery job", "version_id", versionID, "error", err)
	}
}

func (u *teamSkillUsecase) runGuardConsumer() {
	if u.queue == nil {
		return
	}
	for {
		if err := u.recoverPendingGuardVersions(context.Background()); err != nil {
			u.logger.Warn("failed to recover pending skill guard versions", "error", err)
			time.Sleep(guardRecoveryInterval)
			continue
		}
		err := u.queue.StartConsumer(context.Background(), consts.SkillGuardQueueKey, u.handleGuardJob)
		u.logger.Warn("skill guard consumer stopped, retrying", "error", err)
		time.Sleep(guardRecoveryInterval)
	}
}

func (u *teamSkillUsecase) recoverPendingGuardVersions(ctx context.Context) error {
	versions, err := u.repo.ListPendingGuardVersions(ctx)
	if err != nil {
		return err
	}
	enqueuedStages := map[string]bool{}
	for _, version := range versions {
		stageKey := strings.TrimSpace(version.ParsedMeta.PendingStageKey)
		if version.ParsedMeta.PendingGuardOwner == domain.SkillGuardOwnerExtensionPackage && stageKey != "" {
			if enqueuedStages[stageKey] {
				continue
			}
			enqueuedStages[stageKey] = true
		}
		if err := u.enqueueGuardJobIfMissing(ctx, version.ID, time.Now()); err != nil {
			return err
		}
	}
	return nil
}

func (u *teamSkillUsecase) handleGuardJob(ctx context.Context, job *delayqueue.Job[*domain.SkillGuardJob]) error {
	if job == nil || job.Payload == nil {
		return nil
	}
	version, err := u.repo.GetVersion(ctx, job.Payload.VersionID)
	if err != nil {
		if db.IsNotFound(err) {
			return nil
		}
		return err
	}
	if version.GuardStatus != domain.SkillGuardStatusPending {
		return nil
	}
	skill, err := u.repo.GetSkillByID(ctx, version.ResourceID)
	if err != nil {
		if db.IsNotFound(err) {
			return u.repo.RejectVersion(ctx, version.ID, domain.SkillGuardStatusUnavailable, "skill no longer exists")
		}
		return err
	}
	teamID, err := uuid.Parse(skill.ScopeID)
	if err != nil {
		return fmt.Errorf("skill guard recovery: invalid team scope on skill %s: %w", skill.ID, err)
	}
	if version.ParsedMeta.PendingGuardOwner == domain.SkillGuardOwnerExtensionPackage {
		return u.handleExtensionPackageGuardJob(ctx, version, skill, teamID)
	}
	if version.GuardTaskID == nil || strings.TrimSpace(*version.GuardTaskID) == "" {
		return u.repo.RejectVersion(ctx, version.ID, domain.SkillGuardStatusUnavailable, "security scan task id is missing")
	}
	if version.GuardDeadline != nil && !time.Now().Before(*version.GuardDeadline) {
		return u.repo.RejectVersion(ctx, version.ID, domain.SkillGuardStatusUnavailable, "security scan exceeded wait timeout")
	}

	result, err := u.guard.Poll(ctx, strings.TrimSpace(*version.GuardTaskID))
	if err != nil {
		status := domain.SkillGuardStatusUnavailable
		reason := "security scan unavailable or did not complete"
		if errors.Is(err, aiguard.ErrRejected) {
			status = domain.SkillGuardStatusRejected
			reason = "security scan rejected the package"
		}
		return u.repo.RejectVersion(ctx, version.ID, status, reason)
	}
	if result != nil {
		switch strings.ToLower(strings.TrimSpace(result.Status)) {
		case "pending", "running":
			if err := u.enqueueGuardJob(ctx, version.ID, time.Now().Add(guardRecoveryInterval)); err != nil {
				return err
			}
			// The consumer deletes the current payload after a nil handler result.
			// Tell it that this ID was deliberately rescheduled so the replacement
			// job written by enqueueGuardJob remains available.
			return delayqueue.ErrJobRescheduled
		}
	}

	groupIDs := make([]uuid.UUID, 0, len(version.ParsedMeta.PendingGroupIDs))
	for _, raw := range version.ParsedMeta.PendingGroupIDs {
		groupID, parseErr := uuid.Parse(raw)
		if parseErr != nil {
			return fmt.Errorf("skill guard recovery: invalid pending group id %q: %w", raw, parseErr)
		}
		groupIDs = append(groupIDs, groupID)
	}
	return u.repo.ApproveVersion(ctx, teamID, version.ResourceID, version.ID, groupIDs)
}

func (u *teamSkillUsecase) handleExtensionPackageGuardJob(ctx context.Context, version *db.AgentSkillVersion, skill *db.AgentSkill, teamID uuid.UUID) error {
	stageKey := strings.TrimSpace(version.ParsedMeta.PendingStageKey)
	if stageKey == "" {
		return u.repo.RejectVersion(ctx, version.ID, domain.SkillGuardStatusUnavailable, "security scan stage id is missing")
	}
	if version.GuardTaskID == nil || strings.TrimSpace(*version.GuardTaskID) == "" {
		return u.rejectExtensionGuardStage(ctx, stageKey, errors.New("security scan task id is missing"))
	}
	if version.GuardDeadline != nil && !time.Now().Before(*version.GuardDeadline) {
		return u.rejectExtensionGuardStage(ctx, stageKey, errors.New("security scan exceeded wait timeout"))
	}

	result, err := u.guard.Poll(ctx, strings.TrimSpace(*version.GuardTaskID))
	if err != nil {
		return u.rejectExtensionGuardStage(ctx, stageKey, err)
	}
	if result != nil {
		switch strings.ToLower(strings.TrimSpace(result.Status)) {
		case "pending", "running":
			if err := u.enqueueGuardJob(ctx, version.ID, time.Now().Add(guardRecoveryInterval)); err != nil {
				return err
			}
			// See handleGuardJob: returning nil would delete the replacement
			// payload immediately after it is written.
			return delayqueue.ErrJobRescheduled
		}
	}
	if u.stageFinalizer == nil {
		return errors.New("skill guard recovery: extension package stage finalizer is unavailable")
	}
	if _, err := u.stageFinalizer.Finalize(
		ctx,
		stageKey,
		teamID,
		skill.CreatedBy,
		version.ParsedMeta.SourceLabel,
		version.ParsedMeta.PendingPackageVersion,
	); err != nil {
		return err
	}
	versions, err := u.pendingGuardStageVersions(ctx, stageKey)
	if err != nil {
		return err
	}
	if _, err := u.repo.ApproveGuardStage(ctx, teamID, stageKey); err != nil {
		return err
	}
	for _, pendingVersion := range versions {
		u.removeGuardJob(ctx, pendingVersion.ID)
	}
	if err := u.stageFinalizer.Discard(ctx, stageKey); err != nil {
		u.logger.WarnContext(ctx, "failed to discard completed extension package guard stage", "stage_key", stageKey, "error", err)
	}
	return nil
}

func (u *teamSkillUsecase) rejectExtensionGuardStage(ctx context.Context, stageKey string, scanErr error) error {
	if err := u.RejectGuardStage(ctx, stageKey, scanErr); err != nil {
		return err
	}
	if u.stageFinalizer != nil {
		if err := u.stageFinalizer.Discard(ctx, stageKey); err != nil {
			u.logger.WarnContext(ctx, "failed to discard rejected extension package guard stage", "stage_key", stageKey, "error", err)
		}
	}
	return nil
}

// ---- DTO helpers ----

func (u *teamSkillUsecase) loadDTO(ctx context.Context, teamID, skillID uuid.UUID) (*domain.TeamSkill, error) {
	skill, err := u.repo.GetSkill(ctx, teamID, skillID)
	if err != nil {
		return nil, err
	}
	return u.skillToDTO(ctx, skill)
}

func (u *teamSkillUsecase) skillToDTO(ctx context.Context, s *db.AgentSkill) (*domain.TeamSkill, error) {
	dto := &domain.TeamSkill{
		ID:              s.ID,
		Name:            s.Name,
		Description:     s.Description,
		IsForceDelivery: s.IsForceDelivery,
		Enabled:         s.Enabled,
		CreatedAt:       s.CreatedAt.Unix(),
		UpdatedAt:       s.UpdatedAt.Unix(),
	}
	if s.ActiveVersionID != nil {
		ver, err := u.repo.GetActiveVersion(ctx, s.ID)
		if err != nil && !db.IsNotFound(err) {
			return nil, err
		}
		if ver != nil {
			dto.ActiveVersion = ver.Version
			dto.S3Key = ver.S3Key
			dto.Tags = ver.ParsedMeta.Tags
			dto.Categories = ver.ParsedMeta.Categories
			dto.SourceType = ver.ParsedMeta.SourceType
			dto.SourceLabel = ver.ParsedMeta.SourceLabel
		}
	}
	latest, err := u.repo.GetLatestVersion(ctx, s.ID)
	if err != nil && !db.IsNotFound(err) {
		return nil, err
	}
	if latest != nil {
		dto.GuardStatus = latest.GuardStatus
		if latest.GuardTaskID != nil {
			dto.GuardTaskID = *latest.GuardTaskID
		}
		if latest.GuardError != nil {
			dto.GuardError = *latest.GuardError
		}
	}
	groups, err := u.repo.LoadGroups(ctx, s.ID)
	if err != nil {
		return nil, err
	}
	dto.Groups = groups
	return dto, nil
}

// ---- zip helpers ----

// validateSkillZipPackage 校验 zip 至少含一个 SKILL.md(大小写不敏感),返回
// frontmatter 解析出的 tags(没有则 nil)。
func validateSkillZipPackage(data []byte) ([]string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid skill zip package"))
	}
	for _, f := range reader.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if !strings.EqualFold(path.Base(f.Name), "SKILL.md") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, errcode.ErrBadRequest.Wrap(err)
		}
		body, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return nil, errcode.ErrBadRequest.Wrap(err)
		}
		return parseFrontmatterTags(body), nil
	}
	return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("zip package missing SKILL.md"))
}

// parseFrontmatterTags 极简 YAML frontmatter 解析:支持
//
//	tags: ["a", "b"]
//	tags: [a, b]
//	tags:
//	  - a
//	  - b
//
// 找不到/形式不对就返回 nil(降级到 frontmatter 无 tags)。
func parseFrontmatterTags(body []byte) []string {
	s := string(body)
	if !strings.HasPrefix(s, "---") {
		return nil
	}
	end := strings.Index(s[3:], "\n---")
	if end < 0 {
		return nil
	}
	fm := s[3 : 3+end]
	lines := strings.Split(fm, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "tags:") {
			continue
		}
		rest := strings.TrimSpace(strings.TrimPrefix(trimmed, "tags:"))
		if rest != "" {
			// inline array
			rest = strings.TrimSpace(rest)
			if strings.HasPrefix(rest, "[") && strings.HasSuffix(rest, "]") {
				inner := strings.TrimSuffix(strings.TrimPrefix(rest, "["), "]")
				parts := strings.Split(inner, ",")
				out := make([]string, 0, len(parts))
				for _, p := range parts {
					p = strings.Trim(strings.TrimSpace(p), `"'`)
					if p != "" {
						out = append(out, p)
					}
				}
				return out
			}
			return nil
		}
		// block list:- a / - b / ...
		var out []string
		for _, sub := range lines[i+1:] {
			ts := strings.TrimSpace(sub)
			if !strings.HasPrefix(ts, "-") {
				break
			}
			val := strings.Trim(strings.TrimSpace(strings.TrimPrefix(ts, "-")), `"'`)
			if val != "" {
				out = append(out, val)
			}
		}
		return out
	}
	return nil
}

func packageSkillMarkdownContent(content string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("SKILL.md")
	if err != nil {
		return nil, err
	}
	if _, err := w.Write([]byte(content)); err != nil {
		_ = zw.Close()
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func skillPackageFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "skill"
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", ":", "-", " ", "-")
	name = strings.Trim(replacer.Replace(name), ".-")
	if name == "" {
		name = "skill"
	}
	return fmt.Sprintf("%s.zip", name)
}

// ---- misc ----

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func boolDeref(p *bool, dflt bool) bool {
	if p == nil {
		return dflt
	}
	return *p
}
func strDerefOr(p *string, dflt string) string {
	if p == nil {
		return dflt
	}
	return *p
}

// silence cvt import if unused in some build flag
var _ = cvt.Iter[int, int]
