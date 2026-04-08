package taskflow

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
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
	_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task", req)
	return err
}

// Restart implements TaskManager.
func (t *taskClient) Restart(ctx context.Context, req RestartTaskReq) (*RestartTaskResp, error) {
	resp, err := request.Post[Resp[*RestartTaskResp]](t.client, ctx, "/internal/task/restart", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// Stop implements TaskManager.
func (t *taskClient) Stop(ctx context.Context, req TaskReq) error {
	_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/stop", req)
	return err
}

// Cancel implements TaskManager.
func (t *taskClient) Cancel(ctx context.Context, req TaskReq) error {
	_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/cancel", req)
	return err
}

// Continue implements TaskManager.
func (t *taskClient) Continue(ctx context.Context, req TaskReq) error {
	_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/continue", req)
	return err
}

// AutoApprove implements TaskManager.
func (t *taskClient) AutoApprove(ctx context.Context, req TaskApproveReq) error {
	_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/auto-approve", req)
	return err
}

// AskUserQuestion implements TaskManager.
func (t *taskClient) AskUserQuestion(ctx context.Context, req AskUserQuestionResponse) error {
	_, err := request.Post[Resp[any]](t.client, ctx, "/internal/task/ask-user-question", req)
	return err
}

// ListFiles implements TaskManager.
func (t *taskClient) ListFiles(ctx context.Context, req RepoListFilesReq) (*RepoListFiles, error) {
	resp, err := request.Post[Resp[*RepoListFiles]](t.client, ctx, "/internal/task/repo-list-files", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// ReadFile implements TaskManager.
func (t *taskClient) ReadFile(ctx context.Context, req RepoReadFileReq) (*RepoReadFile, error) {
	resp, err := request.Post[Resp[*RepoReadFile]](t.client, ctx, "/internal/task/repo-read-file", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// FileDiff implements TaskManager.
func (t *taskClient) FileDiff(ctx context.Context, req RepoFileDiffReq) (*RepoFileDiff, error) {
	resp, err := request.Post[Resp[*RepoFileDiff]](t.client, ctx, "/internal/task/repo-file-diff", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// FileChanges implements TaskManager.
func (t *taskClient) FileChanges(ctx context.Context, req RepoFileChangesReq) (*RepoFileChanges, error) {
	resp, err := request.Post[Resp[*RepoFileChanges]](t.client, ctx, "/internal/task/repo-file-changes", req)
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}
