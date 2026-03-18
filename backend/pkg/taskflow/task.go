package taskflow

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type taskManagerClient struct {
	client *request.Client
}

func newTaskManagerClient(client *request.Client) TaskManager {
	return &taskManagerClient{client: client}
}

func (c *taskManagerClient) Create(ctx context.Context, req CreateVirtualMachineReq) error {
	_, err := request.Post[any](c.client, ctx, "/internal/tasks", req)
	return err
}

func (c *taskManagerClient) Stop(ctx context.Context, req TaskReq) error {
	_, err := request.Post[any](c.client, ctx, "/internal/tasks/stop", req)
	return err
}

func (c *taskManagerClient) Restart(ctx context.Context, req RestartTaskReq) error {
	_, err := request.Post[any](c.client, ctx, "/internal/tasks/restart", req)
	return err
}

func (c *taskManagerClient) Cancel(ctx context.Context, req TaskReq) error {
	_, err := request.Post[any](c.client, ctx, "/internal/tasks/cancel", req)
	return err
}

func (c *taskManagerClient) Continue(ctx context.Context, req TaskReq) error {
	_, err := request.Post[any](c.client, ctx, "/internal/tasks/continue", req)
	return err
}

func (c *taskManagerClient) AutoApprove(ctx context.Context, req TaskApproveReq) error {
	_, err := request.Post[any](c.client, ctx, "/internal/tasks/approve", req)
	return err
}

func (c *taskManagerClient) AskUserQuestion(ctx context.Context, req AskUserQuestionResponse) error {
	_, err := request.Post[any](c.client, ctx, "/internal/tasks/ask-user-question", req)
	return err
}

func (c *taskManagerClient) ListFiles(ctx context.Context, req RepoListFilesReq) (*RepoListFiles, error) {
	resp, err := request.Post[Resp[*RepoListFiles]](c.client, ctx, "/internal/tasks/repo/list-files", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *taskManagerClient) ReadFile(ctx context.Context, req RepoReadFileReq) (*RepoReadFile, error) {
	resp, err := request.Post[Resp[*RepoReadFile]](c.client, ctx, "/internal/tasks/repo/read-file", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *taskManagerClient) FileDiff(ctx context.Context, req RepoFileDiffReq) (*RepoFileDiff, error) {
	resp, err := request.Post[Resp[*RepoFileDiff]](c.client, ctx, "/internal/tasks/repo/file-diff", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *taskManagerClient) FileChanges(ctx context.Context, req RepoFileChangesReq) (*RepoFileChanges, error) {
	resp, err := request.Post[Resp[*RepoFileChanges]](c.client, ctx, "/internal/tasks/repo/file-changes", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}
