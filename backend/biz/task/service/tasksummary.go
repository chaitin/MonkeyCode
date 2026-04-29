package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/llm"
	"github.com/chaitin/MonkeyCode/backend/pkg/tasklog"
)

var (
	errNoConversation = errors.New("no conversation history found")
)

// TaskSummaryService 任务摘要生成服务
type TaskSummaryService struct {
	cfg                *config.Config
	db                 *db.Client
	llm                *llm.Client
	summaryQueue       *delayqueue.TaskSummaryQueue
	logger             *slog.Logger
	conversationReader ConversationReader

	// 生命周期管理
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

type tasklogGateway interface {
	QueryTurns(ctx context.Context, taskID uuid.UUID, taskCreatedAt time.Time, cursor string, limit int, store consts.LogStore) (*tasklog.QueryTurnsResp, error)
}

type ConversationReader interface {
	Fetch(ctx context.Context, taskID uuid.UUID, createdAt time.Time, store consts.LogStore, initialContent string, maxRounds int) ([]llm.Message, error)
}

type tasklogConversationReader struct {
	gateway tasklogGateway
	logger  *slog.Logger
}

func newTasklogConversationReader(gateway tasklogGateway, logger *slog.Logger) *tasklogConversationReader {
	return &tasklogConversationReader{gateway: gateway, logger: logger}
}

// NewTaskSummaryService 创建任务摘要生成服务
func NewTaskSummaryService(i *do.Injector) (*TaskSummaryService, error) {
	cfg := do.MustInvoke[*config.Config](i)
	d := do.MustInvoke[*db.Client](i)
	tlg := do.MustInvoke[*tasklog.Gateway](i)
	sq := do.MustInvoke[*delayqueue.TaskSummaryQueue](i)
	l := do.MustInvoke[*slog.Logger](i)
	logger := l.With("module", "TaskSummaryService")

	// 使用 task_summary 自己的 LLM 配置，不依赖全局 LLM Client
	llmClient := llm.NewClient(llm.Config{
		BaseURL:       cfg.TaskSummary.BaseURL,
		APIKey:        cfg.TaskSummary.ApiKey,
		Model:         cfg.TaskSummary.Model,
		InterfaceType: llm.InterfaceType(cfg.TaskSummary.InterfaceType),
	})

	s := &TaskSummaryService{
		cfg:                cfg,
		db:                 d,
		llm:                llmClient,
		summaryQueue:       sq,
		logger:             logger,
		conversationReader: newTasklogConversationReader(tlg, logger),
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

	conversation, err := s.fetchConversation(ctx, taskUUID, t.CreatedAt, normalizeSummaryLogStore(t.LogStore), t.Content)
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
	logger.DebugContext(ctx, "fetching conversation", "created_at", createdAt)

	conversation, err := s.fetchConversation(ctx, taskUUID, createdAt, normalizeSummaryLogStore(t.LogStore), t.Content)
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

func (s *TaskSummaryService) fetchConversation(ctx context.Context, taskID uuid.UUID, createdAt time.Time, store consts.LogStore, initialContent string) ([]llm.Message, error) {
	if s.conversationReader == nil {
		return nil, errors.New("task summary conversation reader is nil")
	}
	maxRounds := s.cfg.TaskSummary.MaxRounds
	if maxRounds <= 0 {
		maxRounds = 3
	}

	return s.conversationReader.Fetch(ctx, taskID, createdAt, store, initialContent, maxRounds)
}

func (r *tasklogConversationReader) Fetch(ctx context.Context, taskID uuid.UUID, createdAt time.Time, store consts.LogStore, initialContent string, maxRounds int) ([]llm.Message, error) {
	if r.gateway == nil {
		return nil, errors.New("tasklog gateway is nil")
	}
	if maxRounds <= 0 {
		maxRounds = 3
	}
	logRounds := maxRounds
	if strings.TrimSpace(initialContent) != "" {
		logRounds--
	}
	if logRounds < 0 {
		logRounds = 0
	}
	const pageSize = 20

	var chunks []*tasklog.TurnChunk
	userRoundCount := 0
	cursor := ""

	for logRounds > 0 {
		resp, err := r.gateway.QueryTurns(ctx, taskID, createdAt, cursor, pageSize, store)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch task log history: %w", err)
		}
		if resp == nil {
			break
		}

		stopPaging := false
		for _, chunk := range resp.Chunks {
			if chunk == nil {
				continue
			}
			if (chunk.Event == "user-input" || chunk.Event == "reply-question") && userRoundCount >= logRounds {
				stopPaging = true
				break
			}
			chunks = append(chunks, chunk)
			if chunk.Event == "user-input" || chunk.Event == "reply-question" {
				userRoundCount++
			}
		}

		if stopPaging || userRoundCount >= logRounds || !resp.HasMore || resp.NextCursor == "" {
			break
		}
		cursor = resp.NextCursor
	}

	return buildSummaryConversation(ctx, r.logger, taskID, chunks, userRoundCount, maxRounds, initialContent)
}

func buildSummaryConversation(ctx context.Context, logger *slog.Logger, taskID uuid.UUID, chunks []*tasklog.TurnChunk, userRoundCount, maxRounds int, initialContent string) ([]llm.Message, error) {
	sort.Slice(chunks, func(i, j int) bool {
		a := chunks[i]
		b := chunks[j]
		if a == nil {
			return b != nil
		}
		if b == nil {
			return false
		}
		return a.Timestamp < b.Timestamp
	})

	var messages []llm.Message
	if initialContent != "" {
		messages = append(messages, llm.Message{Role: "user", Content: initialContent})
	}

	agentMsg := []string{}
	for _, chunk := range chunks {
		if chunk == nil || len(chunk.Data) == 0 {
			continue
		}

		decoded, err := base64.StdEncoding.DecodeString(string(chunk.Data))
		if err != nil {
			decoded = chunk.Data
		}

		switch chunk.Event {
		case "user-input":
			userInputText := userInputContent(decoded)

			if len(agentMsg) > 0 {
				agentContent := strings.Join(agentMsg, "")
				messages = append(messages, llm.Message{Role: "assistant", Content: agentContent})
				agentMsg = []string{}
			}

			messages = append(messages, llm.Message{Role: "user", Content: userInputText})

		case "reply-question":
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

	if len(messages) == 0 {
		return nil, errNoConversation
	}

	if len(agentMsg) > 0 {
		agentContent := strings.Join(agentMsg, "")
		messages = append(messages, llm.Message{Role: "assistant", Content: agentContent})
	}

	if logger != nil {
		logger.DebugContext(ctx, "conversation", "task_id", taskID, "messages_count", len(messages), "messages", messages)
	}
	return messages, nil
}

func userInputContent(decoded []byte) string {
	var payload userInputPayload
	if err := json.Unmarshal(decoded, &payload); err == nil && len(payload.Content) > 0 {
		return string(payload.Content)
	}
	return string(decoded)
}

func normalizeSummaryLogStore(store *consts.LogStore) consts.LogStore {
	if store == nil || strings.TrimSpace(string(*store)) == "" {
		return consts.LogStoreLoki
	}
	return *store
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
- 第一条用户消息是任务原始需求，必须优先依据它生成标题
- 后续对话只作为补充上下文，不要把上下文交接、压缩摘要或运行状态总结当成任务标题
- 重点关注用户想要完成什么目标，而不是 AI 问了什么问题
- 标题要具体，让人一看就知道用户想做什么
  - 如果是开发任务：说明做的是什么应用/功能（如"开发五子棋游戏"）
  - 如果是问问题：说明问的是什么问题（如"React Hooks 如何管理状态"）
  - 如果是修 bug：说明修的是什么问题（如"修复用户登录失败问题"）
- 中英文之间要加空格（如"修复 React 组件的 bug"而不是"修复React组件的bug"）
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
