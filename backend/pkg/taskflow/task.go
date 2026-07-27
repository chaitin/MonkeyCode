package taskflow

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
	"github.com/chaitin/MonkeyCode/backend/pkg/telemetry"
)

type taskClient struct {
	client *request.Client
}

func newTaskClient(client *request.Client) TaskManager {
	return &taskClient{
		client: client,
	}
}

// Create implements TaskManager.
func (t *taskClient) Create(ctx context.Context, req CreateTaskReq) error {
	ctx = telemetry.WithTaskID(ctx, req.ID.String())
	ctx = telemetry.WithVMID(ctx, req.VMID)
	telemetry.MarkCritical(ctx)
	return executeMutationError(ctx, targetScope("task", req.ID.String()), req.ID.String(), func(ctx context.Context) error {
		_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task", req,
			fencedRouteOption(ctx, CapabilityAgent, req.VMID))
		return err
	})
}

// Restart implements TaskManager.
func (t *taskClient) Restart(ctx context.Context, req RestartTaskReq) (*RestartTaskResp, error) {
	ctx = telemetry.WithTaskID(ctx, req.ID.String())
	ctx = telemetry.WithRequestID(ctx, req.RequestId)
	telemetry.MarkCritical(ctx)
	resp, err := executeMutation(ctx, targetScope("task", req.ID.String()), req.RequestId, func(ctx context.Context) (*Resp[*RestartTaskResp], error) {
		return request.Post[Resp[*RestartTaskResp]](t.client, ctx, "/internal/task/restart", req,
			fencedRouteOption(ctx, CapabilityTask, req.ID.String()))
	})
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// Stop implements TaskManager.
func (t *taskClient) Stop(ctx context.Context, req TaskReq) error {
	ctx = taskContext(ctx, req)
	telemetry.MarkCritical(ctx)
	taskID := taskReqID(req)
	return executeMutationError(ctx, targetScope("task", taskID), "", func(ctx context.Context) error {
		_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/stop", req,
			fencedRouteOption(ctx, CapabilityTask, taskID))
		return err
	})
}

// Cancel implements TaskManager.
func (t *taskClient) Cancel(ctx context.Context, req TaskReq) error {
	ctx = taskContext(ctx, req)
	telemetry.MarkCritical(ctx)
	telemetry.SetOutcome(ctx, "cancelled")
	taskID := taskReqID(req)
	return executeMutationError(ctx, targetScope("task", taskID), "", func(ctx context.Context) error {
		_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/cancel", req,
			fencedRouteOption(ctx, CapabilityTask, taskID))
		return err
	})
}

// Continue implements TaskManager.
func (t *taskClient) Continue(ctx context.Context, req TaskReq) error {
	ctx = taskContext(ctx, req)
	telemetry.MarkCritical(ctx)
	taskID := taskReqID(req)
	return executeMutationError(ctx, targetScope("task", taskID), "", func(ctx context.Context) error {
		_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/continue", req,
			fencedRouteOption(ctx, CapabilityTask, taskID))
		return err
	})
}

func taskContext(ctx context.Context, req TaskReq) context.Context {
	if req.Task != nil {
		ctx = telemetry.WithTaskID(ctx, req.Task.ID.String())
	}
	if req.VirtualMachine != nil {
		ctx = telemetry.WithVMID(ctx, req.VirtualMachine.ID)
	}
	return ctx
}

// AutoApprove implements TaskManager.
func (t *taskClient) AutoApprove(ctx context.Context, req TaskApproveReq) error {
	return executeMutationError(ctx, targetScope("task", req.ID.String()), "", func(ctx context.Context) error {
		_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/auto-approve", req,
			fencedRouteOption(ctx, CapabilityTask, req.ID.String()))
		return err
	})
}

// AskUserQuestion implements TaskManager.
func (t *taskClient) AskUserQuestion(ctx context.Context, req AskUserQuestionResponse) error {
	return executeMutationError(ctx, targetScope("task", req.TaskId), req.RequestId, func(ctx context.Context) error {
		_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/ask-user-question", req,
			fencedRouteOption(ctx, CapabilityTask, req.TaskId))
		return err
	})
}

// ListFiles implements TaskManager.
func (t *taskClient) ListFiles(ctx context.Context, req RepoListFilesReq) (*RepoListFiles, error) {
	resp, err := request.Post[Resp[*RepoListFiles]](t.client, ctx, "/internal/task/repo-list-files", req,
		routeOption(CapabilityTask, req.TaskId))
	if err != nil {
		return nil, parseTaskflowError(err)
	}
	return resp.Data, nil
}

// ReadFile implements TaskManager.
func (t *taskClient) ReadFile(ctx context.Context, req RepoReadFileReq) (*RepoReadFile, error) {
	resp, err := request.Post[Resp[*RepoReadFile]](t.client, ctx, "/internal/task/repo-read-file", req,
		routeOption(CapabilityTask, req.TaskId))
	if err != nil {
		return nil, parseTaskflowError(err)
	}
	return resp.Data, nil
}

// FileDiff implements TaskManager.
func (t *taskClient) FileDiff(ctx context.Context, req RepoFileDiffReq) (*RepoFileDiff, error) {
	resp, err := request.Post[Resp[*RepoFileDiff]](t.client, ctx, "/internal/task/repo-file-diff", req,
		routeOption(CapabilityTask, req.TaskId))
	if err != nil {
		return nil, parseTaskflowError(err)
	}
	return resp.Data, nil
}

// FileChanges implements TaskManager.
func (t *taskClient) FileChanges(ctx context.Context, req RepoFileChangesReq) (*RepoFileChanges, error) {
	resp, err := request.Post[Resp[*RepoFileChanges]](t.client, ctx, "/internal/task/repo-file-changes", req,
		routeOption(CapabilityTask, req.TaskId))
	if err != nil {
		return nil, parseTaskflowError(err)
	}
	return resp.Data, nil
}

func taskReqID(req TaskReq) string {
	if req.Task == nil {
		return ""
	}
	return req.Task.ID.String()
}
