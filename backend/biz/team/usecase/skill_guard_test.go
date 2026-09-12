package usecase

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentskill"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/aiguard"
	"github.com/chaitin/MonkeyCode/backend/pkg/auditmeta"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
)

func TestTeamSkillUsecaseAddPackageScansOnceAndRecordsAuditMetadata(t *testing.T) {
	packageData, err := packageSkillMarkdownContent("---\nname: guarded-skill\ndescription: guarded\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	guard := &skillGuardStub{
		result: &domain.SkillGuardResult{
			TaskID:          "task-rejected",
			Status:          "completed",
			DetectionResult: "high",
			TraceID:         "trace-1",
		},
		err: aiguard.ErrRejected,
	}
	collector := &auditmeta.Collector{}
	ctx := auditmeta.WithCollector(context.Background(), collector)
	u := &teamSkillUsecase{guard: guard}

	_, err = u.AddPackage(ctx, &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "guarded-skill", Description: "guarded"},
		PackageFilename: "guarded-skill.zip",
		PackageData:     packageData,
	})
	if !errors.Is(err, aiguard.ErrRejected) {
		t.Fatalf("AddPackage() error = %v, want ErrRejected", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
	result, ok := collector.GuardResult()
	if !ok {
		t.Fatal("audit guard result was not recorded")
	}
	if result.TaskID != "task-rejected" || result.Status != "completed" || result.DetectionResult != "high" || result.TraceID != "trace-1" {
		t.Fatalf("audit guard result = %#v", result)
	}
}

func TestTeamSkillUsecaseAddPackageDoesNotWriteWhenGuardIsUnavailable(t *testing.T) {
	packageData, err := packageSkillMarkdownContent("---\nname: guarded-skill\ndescription: guarded\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	guard := &skillGuardStub{err: aiguard.ErrNotConfigured}
	u := &teamSkillUsecase{guard: guard}

	_, err = u.AddPackage(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "guarded-skill", Description: "guarded"},
		PackageFilename: "guarded-skill.zip",
		PackageData:     packageData,
	})
	if !errors.Is(err, aiguard.ErrNotConfigured) {
		t.Fatalf("AddPackage() error = %v, want ErrNotConfigured", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
}

func TestTeamSkillUsecasePersistsPendingVersionBeforePolling(t *testing.T) {
	packageData, err := packageSkillMarkdownContent("---\nname: pending-skill\ndescription: pending\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	repo := &teamSkillRepoStub{}
	guard := &observedSkillGuardStub{}
	u := &teamSkillUsecase{
		repo:             repo,
		objstore:         &skillGuardObjectStoreStub{},
		guard:            guard,
		guardWaitTimeout: time.Minute,
	}

	_, err = u.AddPackage(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "pending-skill", Description: "pending"},
		PackageFilename: "pending-skill.zip",
		PackageData:     packageData,
	})
	if err != nil {
		t.Fatalf("AddPackage() error = %v", err)
	}
	if repo.pendingVersionCalls != 1 {
		t.Fatalf("pending version writes = %d, want 1", repo.pendingVersionCalls)
	}
	if repo.pendingTaskID != "task-pending" {
		t.Fatalf("pending task id = %q, want task-pending", repo.pendingTaskID)
	}
	if repo.approveCalls != 1 {
		t.Fatalf("approve calls = %d, want 1", repo.approveCalls)
	}
	if guard.observedCalls != 1 || guard.scanCalls != 0 {
		t.Fatalf("guard calls observed=%d scan=%d, want 1/0", guard.observedCalls, guard.scanCalls)
	}
}

func TestTeamSkillUsecasePendingGuardHandlerReschedulesPayload(t *testing.T) {
	for _, tc := range []struct {
		name  string
		owner string
	}{
		{name: "standalone"},
		{name: "extension package", owner: domain.SkillGuardOwnerExtensionPackage},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			versionID := uuid.New()
			skillID := uuid.New()
			teamID := uuid.New()
			taskID := "task-pending"
			deadline := time.Now().Add(time.Minute)

			meta := types.SkillParsedMeta{PendingGuardOwner: tc.owner}
			if tc.owner != "" {
				meta.PendingStageKey = "stage-key"
			}
			repo := &teamSkillRepoStub{
				skills: []*db.AgentSkill{{
					ID:        skillID,
					ScopeType: agentskill.ScopeTypeTeam,
					ScopeID:   teamID.String(),
				}},
				pendingVersions: []*db.AgentSkillVersion{{
					ID:            versionID,
					ResourceID:    skillID,
					GuardStatus:   domain.SkillGuardStatusPending,
					GuardTaskID:   &taskID,
					GuardDeadline: &deadline,
					ParsedMeta:    meta,
				}},
			}
			guard := &skillGuardStub{result: &domain.SkillGuardResult{TaskID: taskID, Status: "running"}}

			srv := miniredis.RunT(t)
			rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
			t.Cleanup(func() { _ = rdb.Close() })
			queue := delayqueue.NewSkillGuardQueue(rdb, slog.New(slog.NewTextHandler(io.Discard, nil)))
			u := &teamSkillUsecase{repo: repo, guard: guard, queue: queue}

			err := u.handleGuardJob(ctx, &delayqueue.Job[*domain.SkillGuardJob]{
				Payload: &domain.SkillGuardJob{VersionID: versionID},
			})
			if !errors.Is(err, delayqueue.ErrJobRescheduled) {
				t.Fatalf("handleGuardJob() error = %v, want ErrJobRescheduled", err)
			}
			job, runAt, ok, err := queue.GetJobInfo(ctx, consts.SkillGuardQueueKey, versionID.String())
			if err != nil {
				t.Fatal(err)
			}
			if !ok || job == nil || job.Payload == nil || job.Payload.VersionID != versionID {
				t.Fatalf("rescheduled job = %#v, exists=%v", job, ok)
			}
			if runAt.Before(time.Now()) {
				t.Fatalf("rescheduled job runAt = %s, want future time", runAt)
			}
		})
	}
}

func TestTeamSkillUsecaseCancellationTransfersPendingScanToQueue(t *testing.T) {
	ctx := context.Background()
	packageData, err := packageSkillMarkdownContent("---\nname: pending-skill\ndescription: pending\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	repo := &teamSkillRepoStub{}
	queue, rdb := newSkillGuardTestQueue(t)
	var jobExistsBeforeCancel bool
	guard := &cancellingObservedSkillGuardStub{beforeReturn: func() {
		_, _, ok, infoErr := queue.GetJobInfo(ctx, consts.SkillGuardQueueKey, repo.pendingVersionID.String())
		if infoErr != nil {
			t.Errorf("GetJobInfo() error = %v", infoErr)
		}
		jobExistsBeforeCancel = ok
	}}
	u := &teamSkillUsecase{
		repo:             repo,
		objstore:         &skillGuardObjectStoreStub{},
		guard:            guard,
		queue:            queue,
		guardWaitTimeout: time.Minute,
		logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	_, err = u.AddPackage(ctx, &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "pending-skill", Description: "pending"},
		PackageFilename: "pending-skill.zip",
		PackageData:     packageData,
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("AddPackage() error = %v, want context.Canceled", err)
	}
	if jobExistsBeforeCancel {
		t.Fatal("pending scan was queued before the request-side poller exited")
	}
	_, runAt, ok, err := queue.GetJobInfo(ctx, consts.SkillGuardQueueKey, repo.pendingVersionID.String())
	if err != nil {
		t.Fatal(err)
	}
	if !ok || runAt.After(time.Now()) {
		t.Fatalf("cancelled pending scan was not queued immediately: exists=%v runAt=%s", ok, runAt)
	}
	if zcard, err := rdb.ZCard(ctx, "mcai:skillguard:dq:"+consts.SkillGuardQueueKey+":delayed").Result(); err != nil || zcard != 1 {
		t.Fatalf("queue cardinality = %d, err = %v, want 1", zcard, err)
	}
}

func TestTeamSkillUsecaseApprovalFailureTransfersPendingScanToQueue(t *testing.T) {
	ctx := context.Background()
	packageData, err := packageSkillMarkdownContent("---\nname: pending-skill\ndescription: pending\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	repo := &teamSkillRepoStub{approveErr: errors.New("approval persistence failed")}
	queue, rdb := newSkillGuardTestQueue(t)
	guard := &observedSkillGuardStub{}
	u := &teamSkillUsecase{
		repo:             repo,
		objstore:         &skillGuardObjectStoreStub{},
		guard:            guard,
		queue:            queue,
		guardWaitTimeout: time.Minute,
		logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	_, err = u.AddPackage(ctx, &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "pending-skill", Description: "pending"},
		PackageFilename: "pending-skill.zip",
		PackageData:     packageData,
	})
	if err == nil || !strings.Contains(err.Error(), "approval persistence failed") {
		t.Fatalf("AddPackage() error = %v, want approval failure", err)
	}
	if repo.approveCalls != 1 {
		t.Fatalf("approve calls = %d, want 1", repo.approveCalls)
	}
	_, runAt, ok, err := queue.GetJobInfo(ctx, consts.SkillGuardQueueKey, repo.pendingVersionID.String())
	if err != nil {
		t.Fatal(err)
	}
	if !ok || runAt.After(time.Now()) {
		t.Fatalf("approval failure was not queued for recovery: exists=%v runAt=%s", ok, runAt)
	}
	if zcard, err := rdb.ZCard(ctx, "mcai:skillguard:dq:"+consts.SkillGuardQueueKey+":delayed").Result(); err != nil || zcard != 1 {
		t.Fatalf("queue cardinality = %d, err = %v, want 1", zcard, err)
	}
}

func TestTeamSkillUsecaseRejectFailureTransfersPendingScanToQueue(t *testing.T) {
	ctx := context.Background()
	packageData, err := packageSkillMarkdownContent("---\nname: pending-skill\ndescription: pending\n---\nbody\n")
	if err != nil {
		t.Fatal(err)
	}
	repo := &teamSkillRepoStub{rejectErr: errors.New("reject persistence failed")}
	queue, rdb := newSkillGuardTestQueue(t)
	guard := &observedSkillGuardStub{scanErr: aiguard.ErrUnavailable}
	u := &teamSkillUsecase{
		repo:             repo,
		objstore:         &skillGuardObjectStoreStub{},
		guard:            guard,
		queue:            queue,
		guardWaitTimeout: time.Minute,
		logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	_, err = u.AddPackage(ctx, &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.AddTeamSkillPackageReq{
		AddTeamSkillReq: domain.AddTeamSkillReq{Name: "pending-skill", Description: "pending"},
		PackageFilename: "pending-skill.zip",
		PackageData:     packageData,
	})
	if !errors.Is(err, aiguard.ErrUnavailable) {
		t.Fatalf("AddPackage() error = %v, want ErrUnavailable", err)
	}
	if repo.rejectCalls != 1 {
		t.Fatalf("reject calls = %d, want 1", repo.rejectCalls)
	}
	_, runAt, ok, err := queue.GetJobInfo(ctx, consts.SkillGuardQueueKey, repo.pendingVersionID.String())
	if err != nil {
		t.Fatal(err)
	}
	if !ok || runAt.After(time.Now()) {
		t.Fatalf("reject failure was not queued for recovery: exists=%v runAt=%s", ok, runAt)
	}
	if zcard, err := rdb.ZCard(ctx, "mcai:skillguard:dq:"+consts.SkillGuardQueueKey+":delayed").Result(); err != nil || zcard != 1 {
		t.Fatalf("queue cardinality = %d, err = %v, want 1", zcard, err)
	}
}

func TestTeamExtensionPackageCancellationTransfersPendingStageToRecovery(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	skills := &teamSkillUsecaseStub{}
	finalizer := &extensionPackageStageFinalizerStub{}
	guard := &cancellingObservedSkillGuardStub{}
	u := &teamExtensionPackageUsecase{
		repo:           &extensionPackageRepoStub{},
		skillUsecase:   skills,
		guard:          guard,
		objstore:       &skillGuardObjectStoreStub{},
		stageFinalizer: finalizer,
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	data := makeExtensionZip(t, map[string]string{
		"manifest.json":     `{"package_id":"pack","version":"1.0.0","skills":[{"skill_id":"a","path":"skills/a/SKILL.md"}]}`,
		"skills/a/SKILL.md": "---\nname: skill-a\ndescription: A\n---\nbody-a\n",
	})

	_, err := u.Import(ctx, &domain.TeamUser{User: &domain.User{ID: userID}, Team: &domain.Team{ID: teamID}}, &domain.ImportTeamExtensionPackageReq{Filename: "pack.zip", Data: data})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Import() error = %v, want context.Canceled", err)
	}
	if skills.enqueueStageCalls != 1 || len(skills.adds) != 1 {
		t.Fatalf("enqueue stage calls=%d adds=%d, want 1/1", skills.enqueueStageCalls, len(skills.adds))
	}
	if finalizer.calls != 0 {
		t.Fatalf("finalizer calls = %d, want 0", finalizer.calls)
	}
}

func newSkillGuardTestQueue(t *testing.T) (*delayqueue.SkillGuardQueue, *redis.Client) {
	t.Helper()
	srv := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return delayqueue.NewSkillGuardQueue(rdb, slog.New(slog.NewTextHandler(io.Discard, nil))), rdb
}

func TestTeamSkillUsecaseContentUpdateUsesGuard(t *testing.T) {
	skillID := uuid.New()
	teamID := uuid.New()
	guard := &skillGuardStub{err: aiguard.ErrRejected}
	repo := &teamSkillRepoStub{skills: []*db.AgentSkill{{ID: skillID, Name: "existing-skill", Description: "existing"}}}
	u := &teamSkillUsecase{repo: repo, guard: guard}

	_, err := u.Update(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: teamID},
	}, &domain.UpdateTeamSkillReq{SkillID: skillID, Content: "---\nname: existing-skill\ndescription: existing\n---\nnew body\n"})
	if !errors.Is(err, aiguard.ErrRejected) {
		t.Fatalf("Update() error = %v, want ErrRejected", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
	if repo.updateMetaCalled {
		t.Fatal("content update unexpectedly wrote metadata before the scan")
	}
}

func TestTeamSkillUsecaseMetadataOnlyUpdateSkipsGuard(t *testing.T) {
	skillID := uuid.New()
	description := "new description"
	guard := &skillGuardStub{err: errors.New("guard must not be called")}
	repo := &teamSkillRepoStub{skills: []*db.AgentSkill{{ID: skillID, Name: "existing-skill", Description: "existing"}}}
	u := &teamSkillUsecase{repo: repo, guard: guard}

	if _, err := u.Update(context.Background(), &domain.TeamUser{
		User: &domain.User{ID: uuid.New()},
		Team: &domain.Team{ID: uuid.New()},
	}, &domain.UpdateTeamSkillReq{SkillID: skillID, Description: &description}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if guard.calls != 0 {
		t.Fatalf("guard calls = %d, want 0", guard.calls)
	}
	if !repo.updateMetaCalled {
		t.Fatal("metadata update was not written")
	}
}

func TestTeamExtensionPackageImportScansWholePackageOnce(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	guard := &skillGuardStub{result: &domain.SkillGuardResult{
		TaskID:          "task-safe",
		Status:          "completed",
		DetectionResult: "safe",
	}}
	skills := &teamSkillUsecaseStub{}
	u := &teamExtensionPackageUsecase{
		repo:              &extensionPackageRepoStub{},
		skillUsecase:      skills,
		guard:             guard,
		ruleImporter:      &extensionPackageRuleImporterStub{},
		staticDir:         t.TempDir(),
		staticRoutePrefix: "/static",
	}
	data := makeExtensionZip(t, map[string]string{
		"manifest.json":     `{"package_id":"pack","version":"1.0.0","skills":[{"skill_id":"a","path":"skills/a/SKILL.md"},{"skill_id":"b","path":"skills/b/SKILL.md"}]}`,
		"skills/a/SKILL.md": "---\nname: skill-a\ndescription: A\n---\nbody-a\n",
		"skills/b/SKILL.md": "---\nname: skill-b\ndescription: B\n---\nbody-b\n",
	})

	_, err := u.Import(ctx, &domain.TeamUser{
		User: &domain.User{ID: userID},
		Team: &domain.Team{ID: teamID},
	}, &domain.ImportTeamExtensionPackageReq{Filename: "pack.zip", Data: data})
	if err != nil {
		t.Fatalf("Import() error = %v", err)
	}
	if guard.calls != 1 {
		t.Fatalf("guard calls = %d, want 1", guard.calls)
	}
	if !bytes.Equal(guard.lastRequest.Package, data) {
		t.Fatal("scanner did not receive the original extension package")
	}
	if len(skills.adds) != 2 {
		t.Fatalf("skill adds = %d, want 2", len(skills.adds))
	}
	for i, req := range skills.adds {
		if !req.GuardChecked {
			t.Fatalf("skill add %d did not bypass the per-Skill scan", i)
		}
	}
}

func TestTeamExtensionPackageImportPersistsPendingStageAndFinalizes(t *testing.T) {
	ctx := context.Background()
	teamID := uuid.New()
	userID := uuid.New()
	guard := &observedSkillGuardStub{}
	skills := &teamSkillUsecaseStub{}
	finalizer := &extensionPackageStageFinalizerStub{result: &domain.ExtensionPackageStageResult{CreatedRules: 1, CreatedImages: 1}}
	u := &teamExtensionPackageUsecase{
		repo:           &extensionPackageRepoStub{},
		skillUsecase:   skills,
		guard:          guard,
		objstore:       &skillGuardObjectStoreStub{},
		stageFinalizer: finalizer,
		ruleImporter:   &extensionPackageRuleImporterStub{},
		staticDir:      t.TempDir(),
		logger:         slog.Default(),
	}
	data := makeExtensionZip(t, map[string]string{
		"manifest.json":     `{"package_id":"pack","version":"1.0.0","skills":[{"skill_id":"a","path":"skills/a/SKILL.md"},{"skill_id":"b","path":"skills/b/SKILL.md"}]}`,
		"skills/a/SKILL.md": "---\nname: skill-a\ndescription: A\n---\nbody-a\n",
		"skills/b/SKILL.md": "---\nname: skill-b\ndescription: B\n---\nbody-b\n",
	})

	resp, err := u.Import(ctx, &domain.TeamUser{User: &domain.User{ID: userID}, Team: &domain.Team{ID: teamID}}, &domain.ImportTeamExtensionPackageReq{Filename: "pack.zip", Data: data})
	if err != nil {
		t.Fatalf("Import() error = %v", err)
	}
	if resp.UpdatedSkills != 2 || resp.CreatedRules != 1 || resp.CreatedImages != 1 {
		t.Fatalf("response = %#v", resp)
	}
	if guard.observedCalls != 1 || guard.scanCalls != 0 {
		t.Fatalf("guard calls observed=%d scan=%d, want 1/0", guard.observedCalls, guard.scanCalls)
	}
	if len(skills.adds) != 2 {
		t.Fatalf("skill adds = %d, want 2", len(skills.adds))
	}
	stageKey := skills.adds[0].GuardStageKey
	for i, req := range skills.adds {
		if req.GuardTaskID != "task-pending" || req.GuardDeadline.IsZero() || req.GuardStageKey == "" {
			t.Fatalf("skill add %d missing pending guard state: %#v", i, req)
		}
		if req.GuardStageKey != stageKey || req.PendingGuardOwner != domain.SkillGuardOwnerExtensionPackage {
			t.Fatalf("skill add %d not grouped under extension stage: %#v", i, req)
		}
	}
	if finalizer.calls != 1 || skills.approveStageCalls != 1 || finalizer.discardCalls != 1 {
		t.Fatalf("finalizer calls=%d approve=%d discard=%d", finalizer.calls, skills.approveStageCalls, finalizer.discardCalls)
	}
}

func TestTeamSkillUsecaseRecoversPendingExtensionStage(t *testing.T) {
	stageKey := "agent-resources/extension-package-staging/team/stage/package.zip"
	skillID := uuid.New()
	versionID := uuid.New()
	teamID := uuid.New()
	userID := uuid.New()
	taskID := "task-pending"
	deadline := time.Now().Add(time.Hour)
	version := &db.AgentSkillVersion{
		ID:            versionID,
		ResourceID:    skillID,
		GuardStatus:   domain.SkillGuardStatusPending,
		GuardTaskID:   &taskID,
		GuardDeadline: &deadline,
		ParsedMeta:    types.SkillParsedMeta{PendingGuardOwner: domain.SkillGuardOwnerExtensionPackage, PendingStageKey: stageKey, SourceLabel: "pack", PendingPackageVersion: "1.0.0"},
	}
	repo := &teamSkillRepoStub{pendingVersions: []*db.AgentSkillVersion{version}}
	repo.skills = []*db.AgentSkill{{ID: skillID, ScopeType: "team", ScopeID: teamID.String(), CreatedBy: userID}}
	guard := &skillGuardStub{result: &domain.SkillGuardResult{TaskID: "task-pending", Status: "completed", DetectionResult: "safe"}}
	finalizer := &extensionPackageStageFinalizerStub{}
	u := &teamSkillUsecase{repo: repo, guard: guard, stageFinalizer: finalizer, logger: slog.Default()}

	err := u.handleGuardJob(context.Background(), &delayqueue.Job[*domain.SkillGuardJob]{Payload: &domain.SkillGuardJob{VersionID: versionID}})
	if err != nil {
		t.Fatalf("handleGuardJob() error = %v", err)
	}
	if finalizer.calls != 1 || repo.approveStageCalls != 1 {
		t.Fatalf("finalizer calls=%d approve stage calls=%d, want 1/1", finalizer.calls, repo.approveStageCalls)
	}
}

type skillGuardStub struct {
	calls       int
	lastRequest domain.SkillGuardRequest
	result      *domain.SkillGuardResult
	err         error
}

type observedSkillGuardStub struct {
	observedCalls int
	scanCalls     int
	scanErr       error
}

type cancellingObservedSkillGuardStub struct {
	beforeReturn func()
}

func (*cancellingObservedSkillGuardStub) Scan(context.Context, domain.SkillGuardRequest) (*domain.SkillGuardResult, error) {
	return nil, errors.New("Scan must not be called by the guarded write path")
}

func (s *cancellingObservedSkillGuardStub) ScanObserved(_ context.Context, _ domain.SkillGuardRequest, onTask func(*domain.SkillGuardResult) error) (*domain.SkillGuardResult, error) {
	pending := &domain.SkillGuardResult{TaskID: "task-pending", Status: "running"}
	if err := onTask(pending); err != nil {
		return pending, err
	}
	if s.beforeReturn != nil {
		s.beforeReturn()
	}
	return pending, context.Canceled
}

func (*cancellingObservedSkillGuardStub) Poll(context.Context, string) (*domain.SkillGuardResult, error) {
	return nil, errors.New("Poll must not be called by the cancelled request path")
}

func (s *observedSkillGuardStub) Scan(context.Context, domain.SkillGuardRequest) (*domain.SkillGuardResult, error) {
	s.scanCalls++
	return nil, errors.New("Scan must not be called by the guarded write path")
}

func (s *observedSkillGuardStub) ScanObserved(_ context.Context, _ domain.SkillGuardRequest, onTask func(*domain.SkillGuardResult) error) (*domain.SkillGuardResult, error) {
	s.observedCalls++
	pending := &domain.SkillGuardResult{TaskID: "task-pending", Status: "running"}
	if err := onTask(pending); err != nil {
		return pending, err
	}
	if s.scanErr != nil {
		return pending, s.scanErr
	}
	return &domain.SkillGuardResult{TaskID: "task-pending", Status: "completed", DetectionResult: "safe"}, nil
}

func (s *observedSkillGuardStub) Poll(context.Context, string) (*domain.SkillGuardResult, error) {
	return nil, errors.New("Poll must not be called by ScanObserved")
}

func (s *skillGuardStub) Scan(_ context.Context, req domain.SkillGuardRequest) (*domain.SkillGuardResult, error) {
	s.calls++
	s.lastRequest = req
	return s.result, s.err
}

func (s *skillGuardStub) ScanObserved(ctx context.Context, req domain.SkillGuardRequest, onTask func(*domain.SkillGuardResult) error) (*domain.SkillGuardResult, error) {
	result, err := s.Scan(ctx, req)
	if err == nil && result != nil && onTask != nil {
		status := strings.ToLower(strings.TrimSpace(result.Status))
		if status == "" || status == "pending" || status == "running" {
			if err := onTask(result); err != nil {
				return result, err
			}
		}
	}
	return result, err
}

func (s *skillGuardStub) Poll(context.Context, string) (*domain.SkillGuardResult, error) {
	return s.result, s.err
}

type teamSkillUsecaseStub struct {
	adds              []*domain.AddTeamSkillReq
	approveStageCalls int
	enqueueStageCalls int
}

func (s *teamSkillUsecaseStub) List(context.Context, *domain.TeamUser) (*domain.ListTeamSkillsResp, error) {
	return &domain.ListTeamSkillsResp{}, nil
}

func (s *teamSkillUsecaseStub) Add(_ context.Context, _ *domain.TeamUser, req *domain.AddTeamSkillReq) (*domain.TeamSkill, error) {
	s.adds = append(s.adds, req)
	return &domain.TeamSkill{}, nil
}

func (s *teamSkillUsecaseStub) AddPackage(context.Context, *domain.TeamUser, *domain.AddTeamSkillPackageReq) (*domain.TeamSkill, error) {
	return &domain.TeamSkill{}, nil
}

func (s *teamSkillUsecaseStub) ApproveGuardStage(context.Context, uuid.UUID, string) error {
	s.approveStageCalls++
	return nil
}

func (s *teamSkillUsecaseStub) RejectGuardStage(context.Context, string, error) error {
	return nil
}

func (s *teamSkillUsecaseStub) EnqueueGuardStage(context.Context, string) error {
	s.enqueueStageCalls++
	return nil
}

func (s *teamSkillUsecaseStub) Update(context.Context, *domain.TeamUser, *domain.UpdateTeamSkillReq) (*domain.TeamSkill, error) {
	return &domain.TeamSkill{}, nil
}

func (s *teamSkillUsecaseStub) Delete(context.Context, *domain.TeamUser, *domain.DeleteTeamSkillReq) error {
	return nil
}

var _ domain.SkillGuard = (*skillGuardStub)(nil)
var _ domain.TeamSkillUsecase = (*teamSkillUsecaseStub)(nil)

type teamSkillRepoStub struct {
	skills              []*db.AgentSkill
	updateMetaCalled    bool
	pendingVersionCalls int
	pendingVersionID    uuid.UUID
	pendingTaskID       string
	approveCalls        int
	approveErr          error
	rejectCalls         int
	rejectErr           error
	approveStageCalls   int
	pendingVersions     []*db.AgentSkillVersion
}

type extensionPackageStageFinalizerStub struct {
	calls        int
	discardCalls int
	result       *domain.ExtensionPackageStageResult
	err          error
}

func (s *extensionPackageStageFinalizerStub) Finalize(context.Context, string, uuid.UUID, uuid.UUID, string, string) (*domain.ExtensionPackageStageResult, error) {
	s.calls++
	if s.result == nil {
		s.result = &domain.ExtensionPackageStageResult{}
	}
	return s.result, s.err
}

func (s *extensionPackageStageFinalizerStub) Discard(context.Context, string) error {
	s.discardCalls++
	return nil
}

type skillGuardObjectStoreStub struct{}

func (*skillGuardObjectStoreStub) GetObject(context.Context, string) (io.ReadCloser, error) {
	return nil, errors.New("unexpected GetObject")
}

func (*skillGuardObjectStoreStub) PresignGet(context.Context, string, time.Duration) (string, error) {
	return "", errors.New("unexpected PresignGet")
}

func (*skillGuardObjectStoreStub) PutFile(context.Context, string, string, io.Reader) error {
	return nil
}

func (*skillGuardObjectStoreStub) DeleteObject(context.Context, string) error { return nil }

func (s *teamSkillRepoStub) List(context.Context, uuid.UUID) ([]*db.AgentSkill, error) {
	return s.skills, nil
}

func (s *teamSkillRepoStub) GetSkill(_ context.Context, _, skillID uuid.UUID) (*db.AgentSkill, error) {
	for _, skill := range s.skills {
		if skill.ID == skillID {
			return skill, nil
		}
	}
	return &db.AgentSkill{ID: skillID, Name: "existing-skill", Description: "existing"}, nil
}

func (s *teamSkillRepoStub) GetBareRepoID(context.Context, uuid.UUID) (uuid.UUID, error) {
	return uuid.New(), nil
}

func (s *teamSkillRepoStub) UpsertSkill(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, string, bool, string) (*db.AgentSkill, error) {
	return &db.AgentSkill{ID: uuid.New(), Name: "guarded-skill", Enabled: true}, nil
}

func (s *teamSkillRepoStub) CreateVersion(context.Context, uuid.UUID, string, string, domain.SkillVersionMeta) (*db.AgentSkillVersion, error) {
	return &db.AgentSkillVersion{}, nil
}

func (s *teamSkillRepoStub) CreatePendingVersion(_ context.Context, skillID uuid.UUID, _, _ string, _ domain.SkillVersionMeta, _ []uuid.UUID, taskID string, _ time.Time) (*db.AgentSkillVersion, error) {
	s.pendingVersionCalls++
	s.pendingTaskID = taskID
	s.pendingVersionID = uuid.New()
	return &db.AgentSkillVersion{ID: s.pendingVersionID, ResourceID: skillID, GuardStatus: domain.SkillGuardStatusPending}, nil
}

func (s *teamSkillRepoStub) GetVersion(context.Context, uuid.UUID) (*db.AgentSkillVersion, error) {
	if len(s.pendingVersions) > 0 {
		return s.pendingVersions[0], nil
	}
	return nil, &db.NotFoundError{}
}

func (s *teamSkillRepoStub) ListPendingGuardVersions(context.Context) ([]*db.AgentSkillVersion, error) {
	return s.pendingVersions, nil
}

func (s *teamSkillRepoStub) ApproveVersion(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, []uuid.UUID) error {
	s.approveCalls++
	return s.approveErr
}

func (s *teamSkillRepoStub) RejectVersion(context.Context, uuid.UUID, string, string) error {
	s.rejectCalls++
	return s.rejectErr
}

func (s *teamSkillRepoStub) ApproveGuardStage(context.Context, uuid.UUID, string) (int, error) {
	s.approveCalls++
	s.approveStageCalls++
	return 1, nil
}

func (s *teamSkillRepoStub) RejectGuardStage(context.Context, string, string, string) (int, error) {
	return 1, nil
}

func (s *teamSkillRepoStub) UpdateMeta(context.Context, uuid.UUID, uuid.UUID, string, *string, *bool) (*db.AgentSkill, error) {
	s.updateMetaCalled = true
	return &db.AgentSkill{}, nil
}

func (s *teamSkillRepoStub) UpdateActiveVersionTags(context.Context, uuid.UUID, []string) error {
	return nil
}

func (s *teamSkillRepoStub) SoftDeleteSkill(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}

func (s *teamSkillRepoStub) ReplaceGroupBindings(context.Context, uuid.UUID, uuid.UUID, []uuid.UUID) error {
	return nil
}

func (s *teamSkillRepoStub) GetActiveVersion(context.Context, uuid.UUID) (*db.AgentSkillVersion, error) {
	return nil, nil
}

func (s *teamSkillRepoStub) GetLatestVersion(context.Context, uuid.UUID) (*db.AgentSkillVersion, error) {
	return nil, &db.NotFoundError{}
}

func (s *teamSkillRepoStub) GetSkillByID(context.Context, uuid.UUID) (*db.AgentSkill, error) {
	if len(s.skills) > 0 {
		return s.skills[0], nil
	}
	return nil, &db.NotFoundError{}
}

func (s *teamSkillRepoStub) NextVersionFor(context.Context, uuid.UUID) (string, error) {
	return "v1", nil
}

func (s *teamSkillRepoStub) LoadGroups(context.Context, uuid.UUID) ([]domain.SkillGroupRef, error) {
	return nil, nil
}

var _ domain.TeamSkillRepo = (*teamSkillRepoStub)(nil)
