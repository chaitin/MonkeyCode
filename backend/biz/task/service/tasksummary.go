package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/llm"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
)

var (
	errNoConversation = errors.New("no conversation history found")
)

// TaskSummaryService 任务摘要生成服务
type TaskSummaryService struct {
	cfg          *config.Config
	db           *db.Client
	loki         *loki.Client
	llm          *llm.Client
	summaryQueue *delayqueue.TaskSummaryQueue
	logger       *slog.Logger
	taskRepo     domain.TaskRepo

	// 生命周期管理
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewTaskSummaryService 创建任务摘要生成服务
func NewTaskSummaryService(i *do.Injector) (*TaskSummaryService, error) {
	cfg := do.MustInvoke[*config.Config](i)
	d := do.MustInvoke[*db.Client](i)
	lok := do.MustInvoke[*loki.Client](i)
	sq := do.MustInvoke[*delayqueue.TaskSummaryQueue](i)
	l := do.MustInvoke[*slog.Logger](i)
	tr := do.MustInvoke[domain.TaskRepo](i)

	// 使用 task_summary 自己的 LLM 配置，不依赖全局 LLM Client
	llmClient := llm.NewClient(llm.Config{
		BaseURL:       cfg.TaskSummary.BaseURL,
		APIKey:        cfg.TaskSummary.ApiKey,
		Model:         cfg.TaskSummary.Model,
		InterfaceType: llm.InterfaceType(cfg.TaskSummary.InterfaceType),
	})

	s := &TaskSummaryService{
		cfg:          cfg,
		db:           d,
		loki:         lok,
		llm:          llmClient,
		summaryQueue: sq,
		logger:       l.With("module", "TaskSummaryService"),
		taskRepo:     tr,
	}

	// 启动消费者
	s.Start(context.Background())

	return s, nil
}

// Start 启动消费者（由 server 启动流程调用）
func (s *TaskSummaryService) Start(ctx context.Context) {
	if !s.cfg.TaskSummary.Enabled {
		s.logger.Info("task summary service is disabled")
		return
	}

	s.logger.Info("task summary service is starting",
		"delay", s.cfg.TaskSummary.Delay,
		"max_chars", s.cfg.TaskSummary.MaxChars,
	)

	ctx, s.cancel = context.WithCancel(ctx)
	s.startConsumer(ctx)
}

// Close 优雅关闭消费者
func (s *TaskSummaryService) Close() {
	if s.cancel != nil {
		s.logger.Info("task summary service is stopping")
		s.cancel()
		s.wg.Wait()
		s.logger.Info("task summary service stopped")
	}
}

// EnqueueSummary 将任务加入摘要生成队列
func (s *TaskSummaryService) EnqueueSummary(ctx context.Context, taskID string, createdAt time.Time) error {
	if !s.cfg.TaskSummary.Enabled {
		s.logger.DebugContext(ctx, "task summary is disabled, skip enqueue", "task_id", taskID)
		return nil
	}
	s.logger.DebugContext(ctx, "enqueueing task summary", "task_id", taskID, "created_at", createdAt)

	payload := &delayqueue.TaskSummaryPayload{
		TaskID:    taskID,
		CreatedAt: createdAt.Unix(),
	}

	delay := time.Duration(s.cfg.TaskSummary.Delay) * time.Second
	if delay <= 0 {
		delay = 1 * time.Hour
	}
	runAt := time.Now().Add(delay)

	if _, err := s.summaryQueue.Enqueue(ctx, consts.TaskSummaryQueueKey, payload, runAt, taskID); err != nil {
		s.logger.ErrorContext(ctx, "failed to enqueue task summary", "task_id", taskID, "error", err)
		return err
	}
	s.logger.DebugContext(ctx, "enqueued task summary", "task_id", taskID, "run_at", runAt)
	return nil
}

// GenerateSummaryNow 立即生成任务摘要（用于手动触发），返回生成的摘要
func (s *TaskSummaryService) GenerateSummaryNow(ctx context.Context, taskID string) (string, error) {
	logger := s.logger.With("task_id", taskID)

	taskUUID, err := uuid.Parse(taskID)
	if err != nil {
		logger.ErrorContext(ctx, "invalid task id", "error", err)
		return "", fmt.Errorf("invalid task id: %w", err)
	}

	t, err := s.db.Task.Query().Where(task.ID(taskUUID)).Only(ctx)
	if err != nil {
		logger.ErrorContext(ctx, "failed to get task", "error", err)
		return "", fmt.Errorf("failed to get task: %w", err)
	}

	conversation, err := s.fetchConversation(ctx, taskID, t.CreatedAt)
	if err != nil {
		if errors.Is(err, errNoConversation) {
			return "", nil
		}
		logger.ErrorContext(ctx, "failed to fetch conversation", "error", err)
		return "", err
	}
	logger.DebugContext(ctx, "fetched conversation", "messages_count", len(conversation))

	summary, err := s.generateSummary(ctx, conversation)
	if err != nil {
		logger.ErrorContext(ctx, "failed to generate summary", "error", err)
		return "", err
	}

	if err := s.db.Task.UpdateOneID(taskUUID).SetSummary(summary).Exec(ctx); err != nil {
		logger.ErrorContext(ctx, "failed to update task summary", "error", err)
		return "", err
	}

	logger.DebugContext(ctx, "task summary generated successfully", "summary", summary)
	return summary, nil
}

// startConsumer 启动消费者
func (s *TaskSummaryService) startConsumer(ctx context.Context) {
	maxWorkers := s.cfg.TaskSummary.MaxWorkers
	if maxWorkers <= 0 {
		maxWorkers = 5
	}
	s.logger.Info("task summary consumer started", "queue", consts.TaskSummaryQueueKey, "workers", maxWorkers)

	for i := 0; i < maxWorkers; i++ {
		s.wg.Add(1)
		go s.runWorker(ctx, i)
	}
}

// runWorker 运行单个消费者 worker
func (s *TaskSummaryService) runWorker(ctx context.Context, workerID int) {
	defer s.wg.Done()

	for {
		select {
		case <-ctx.Done():
			s.logger.Info("worker stopping due to context cancellation", "workerID", workerID)
			return
		default:
			if err := s.summaryQueue.StartConsumer(ctx, consts.TaskSummaryQueueKey, s.handleJob); err != nil {
				if ctx.Err() != nil {
					s.logger.Info("worker stopping due to context cancellation", "workerID", workerID)
					return
				}
				s.logger.Warn("task summary queue consumer stopped, retrying", "workerID", workerID, "error", err)
				time.Sleep(2 * time.Second)
			}
		}
	}
}

// handleJob 处理摘要生成任务
func (s *TaskSummaryService) handleJob(ctx context.Context, job *delayqueue.Job[*delayqueue.TaskSummaryPayload]) error {
	if job == nil || job.Payload == nil {
		return nil
	}

	taskID := job.Payload.TaskID
	logger := s.logger.With("task_id", taskID, "attempts", job.Attempts)

	logger.DebugContext(ctx, "start processing task summary job")

	taskUUID, err := uuid.Parse(taskID)
	if err != nil {
		logger.ErrorContext(ctx, "invalid task id", "error", err)
		return nil // 不重试
	}

	t, err := s.db.Task.Query().Where(task.ID(taskUUID)).Only(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			logger.InfoContext(ctx, "task not found, skip")
			return nil
		}
		return err
	}

	createdAt := t.CreatedAt
	logger.DebugContext(ctx, "fetching conversation from loki", "created_at", createdAt)

	conversation, err := s.fetchConversation(ctx, taskID, createdAt)
	if err != nil {
		if errors.Is(err, errNoConversation) {
			logger.InfoContext(ctx, "no conversation found, skip")
			return nil
		}
		logger.ErrorContext(ctx, "failed to fetch conversation", "error", err)
		return err
	}
	logger.DebugContext(ctx, "fetched conversation", "messages_count", len(conversation))

	summary, err := s.generateSummary(ctx, conversation)
	if err != nil {
		logger.ErrorContext(ctx, "failed to generate summary", "error", err)
		return err
	}

	if err := s.db.Task.UpdateOneID(taskUUID).SetSummary(summary).Exec(ctx); err != nil {
		logger.ErrorContext(ctx, "failed to update task summary", "error", err)
		return err
	}

	logger.DebugContext(ctx, "task summary generated successfully", "summary", summary)
	return nil
}

// fetchConversation 从 Loki 获取历史对话，返回消息数组
func (s *TaskSummaryService) fetchConversation(ctx context.Context, taskID string, createdAt time.Time) ([]llm.Message, error) {
	var messages []llm.Message

	taskUUID, err := uuid.Parse(taskID)
	if err != nil {
		return nil, fmt.Errorf("failed to parse task id: %w", err)
	}

	t, err := s.taskRepo.GetByID(ctx, taskUUID)
	if err != nil {
		return nil, fmt.Errorf("failed to get task: %w", err)
	}
	messages = append(messages, llm.Message{Role: "user", Content: t.Content})

	agentMsg := []string{}
	_, err = s.loki.History(ctx, taskID, createdAt, func(entries []loki.LogEntry) {
		for _, entry := range entries {
			if entry.Line == "" {
				continue
			}

			s.logger.DebugContext(ctx, "loki entry", "entry", entry.Line)

			var lokiEnt lokiEntry
			if err := json.Unmarshal([]byte(entry.Line), &lokiEnt); err != nil {
				s.logger.ErrorContext(ctx, "failed to unmarshal loki entry", "task_id", taskID, "error", err)
				continue
			}

			if lokiEnt.Data == "" {
				continue
			}

			decoded, err := base64.StdEncoding.DecodeString(lokiEnt.Data)
			if err != nil {
				s.logger.ErrorContext(ctx, "failed to decode base64 data", "task_id", taskID, "error", err)
				continue
			}

			switch lokiEnt.Event {
			case "user-input", "reply-question":
				var userInputText string
				var ur userReply
				if err := json.Unmarshal(decoded, &ur); err != nil {
					userInputText = string(decoded)
				} else {
					userInputText = ur.AnswersJSON
				}

				if len(agentMsg) > 0 {
					agentContent := strings.Join(agentMsg, "")
					messages = append(messages, llm.Message{Role: "assistant", Content: agentContent})
					agentMsg = []string{}
				}

				messages = append(messages, llm.Message{Role: "user", Content: userInputText})

			case "task-running":
				var taskMsg wsData
				if err := json.Unmarshal(decoded, &taskMsg); err != nil {
					continue
				}
				if taskMsg.Update.SessionUpdate == "agent_message_chunk" {
					agentMsg = append(agentMsg, taskMsg.Update.Content.Text)
				}
			}
		}
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch loki history: %w", err)
	}

	if len(messages) == 0 {
		return nil, errNoConversation
	}

	if len(agentMsg) > 0 {
		agentContent := strings.Join(agentMsg, "")
		messages = append(messages, llm.Message{Role: "assistant", Content: agentContent})
	}

	s.logger.DebugContext(ctx, "conversation", "messages_count", messages)
	return messages, nil
}

// generateSummary 调用 LLM 生成摘要
func (s *TaskSummaryService) generateSummary(ctx context.Context, conversation []llm.Message) (string, error) {
	systemPrompt := `你是一个对话标题生成器，专门为用户与 AI 助手的对话生成简短、具体的标题。你只输出标题本身，不做任何解释。`

	maxChars := s.cfg.TaskSummary.MaxChars
	if maxChars <= 0 {
		maxChars = 300
	}

	userPrompt := fmt.Sprintf(`请根据以上对话，总结用户的核心意图，生成一个简短标题。

要求：
- 不超过%d字
- 不要标点结尾
- 只输出标题，不要解释
- 重点关注用户想要完成什么目标，而不是 AI 问了什么问题
- 标题要具体，让人一看就知道用户想做什么
  - 如果是开发任务：说明做的是什么应用/功能（如"开发五子棋游戏"）
  - 如果是问问题：说明问的是什么问题（如"React Hooks 如何管理状态"）
  - 如果是修 bug：说明修的是什么问题（如"修复用户登录失败问题"）
- 如果对话无实质内容，就用最近一条用户输入作为标题`, maxChars)

	messages := []llm.Message{
		{Role: "system", Content: systemPrompt},
	}
	messages = append(messages, conversation...)
	messages = append(messages, llm.Message{Role: "user", Content: userPrompt})

	resp, err := s.llm.Chat(ctx, llm.ChatRequest{
		Messages:    messages,
		MaxTokens:   1000,
		Temperature: 0.1,
	})
	if err != nil {
		return "", fmt.Errorf("llm chat failed: %w", err)
	}

	return strings.TrimSpace(resp.Content), nil
}
