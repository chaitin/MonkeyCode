package usecase

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// fillAgentResourceBaseline 把落库的基线填进 domain.Task.Extra（cvt 不映射嵌套字段）。
// tk.Extra 为 nil 时初始化；只赋 SkillIDs/PluginIDs 两个字段，不覆盖 Extra 其他字段。
func fillAgentResourceBaseline(tk *domain.Task, skillIDs, pluginIDs []string) {
	if tk.Extra == nil {
		tk.Extra = &domain.TaskExtraConfig{}
	}
	tk.Extra.SkillIDs = skillIDs
	tk.Extra.PluginIDs = pluginIDs
}

// normalizeAgentResources 确保 AgentResources 非 nil；nil 入参转为空结构体（表达"清空"语义）。
// 该函数为纯函数，便于单独测试。
func normalizeAgentResources(ar *taskflow.AgentResources) *taskflow.AgentResources {
	if ar == nil {
		return &taskflow.AgentResources{}
	}
	return ar
}

// SwitchAgentResources 切换运行中任务的 skill/plugin 列表
func (a *TaskUsecase) SwitchAgentResources(ctx context.Context, user *domain.User, taskID uuid.UUID, req domain.SwitchAgentResourcesReq) (*domain.SwitchAgentResourcesResp, error) {
	t, owner, err := a.Info(ctx, user, taskID)
	if err != nil {
		return nil, err
	}
	if !owner && !a.isPrivileged(ctx, user.ID) {
		return nil, errcode.ErrForbidden
	}
	if t.Status != consts.TaskStatusProcessing {
		return nil, fmt.Errorf("task is not processing")
	}
	if t.VirtualMachine == nil {
		return nil, fmt.Errorf("task virtual machine is nil")
	}

	taskOwnerID := t.UserID

	// 取任务当前生效模型（无需重新校验访问权限，创建/上次切换时已校验过）
	if t.Model == nil || t.Model.ID == uuid.Nil {
		return nil, fmt.Errorf("task has no active model")
	}
	model, err := a.modelRepo.Get(ctx, taskOwnerID, t.Model.ID)
	if err != nil {
		return nil, err
	}

	// 创建 runtime API key 并覆盖 BaseURL，删除 redis 缓存（与 SwitchModel 相同套路）
	runtimeKey, err := a.modelRepo.CreateRuntimeAPIKey(ctx, taskOwnerID, t.Model.ID, t.VirtualMachine.ID)
	if err != nil {
		return nil, err
	}
	if runtimeKey != "" {
		model.APIKey = runtimeKey
		if a.cfg != nil {
			model.BaseURL = a.cfg.LLMProxy.BaseURL + "/v1"
		}
		if a.redis != nil {
			if err := a.redis.Del(ctx, consts.PublicModelKey(runtimeKey)).Err(); err != nil {
				return nil, fmt.Errorf("delete model cache: %w", err)
			}
		}
	}

	coding, configs, agentRes, err := a.getCodingConfigs(ctx, t.CliName, model, req.SkillIDs, req.PluginIDs, a.userScope(ctx, user), false)
	if err != nil {
		return nil, err
	}
	if coding != taskflow.CodingAgentOpenCode {
		return nil, fmt.Errorf("switch agent resources only supports opencode runtime")
	}

	envs := map[string]string{
		"OPENAI_API_KEY":                   model.APIKey,
		"OPEN_CODE_API_KEY":                model.APIKey,
		"OPENCODE_DISABLE_DEFAULT_PLUGINS": "1",
		"OPENCODE_DISABLE_LSP_DOWNLOAD":    "true",
	}
	if model.InterfaceType != "" {
		envs["MCAI_MODEL_PROVIDER_TYPE"] = model.InterfaceType
	}

	if user.ID != taskOwnerID {
		a.logger.InfoContext(ctx, "switch agent resources on behalf of task owner", "operator_id", user.ID, "task_owner_id", taskOwnerID, "task_id", taskID)
	}

	resp, err := a.taskflow.TaskManager().Restart(ctx, taskflow.RestartTaskReq{
		ID:          taskID,
		RequestId:   req.RequestID,
		LoadSession: true,
		LogStore:    string(t.LogStore),
		ExecutionConfig: &taskflow.TaskExecutionConfig{
			ConfigFiles:    configs,
			Envs:           envs,
			AgentResources: normalizeAgentResources(agentRes),
		},
	})
	if err != nil {
		return nil, err
	}
	if resp == nil {
		resp = &taskflow.RestartTaskResp{
			RequestId: req.RequestID,
			Success:   false,
			Message:   "taskflow restart response is nil",
		}
	}

	if resp.Success {
		if updateErr := a.repo.UpdateAgentResourceSelection(ctx, taskID, req.SkillIDs, req.PluginIDs); updateErr != nil {
			a.logger.ErrorContext(ctx, "failed to persist agent resource selection after restart", "error", updateErr, "task_id", taskID)
		}
	}

	a.logger.InfoContext(ctx, "switch agent resources",
		"operator_id", user.ID,
		"task_id", taskID,
		"skill_ids", req.SkillIDs,
		"plugin_ids", req.PluginIDs,
		"success", resp.Success,
	)

	return &domain.SwitchAgentResourcesResp{
		RequestID: resp.RequestId,
		Success:   resp.Success,
		Message:   resp.Message,
		SessionID: resp.SessionID,
	}, nil
}
