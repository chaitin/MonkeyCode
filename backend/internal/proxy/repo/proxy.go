package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/apikey"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/taskrecord"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/rule"
	"github.com/chaitin/MonkeyCode/backend/pkg/diff"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type ProxyRepo struct {
	db    *db.Client
	redis *redis.Client
}

func NewProxyRepo(db *db.Client, redis *redis.Client) domain.ProxyRepo {
	return &ProxyRepo{db: db, redis: redis}
}

func (r *ProxyRepo) SelectModelWithLoadBalancing(modelName string, modelType consts.ModelType) (*db.Model, error) {
	ctx := context.Background()
	m, err := r.db.Model.Query().
		Where(model.ModelName(modelName), model.ModelType(modelType)).
		First(ctx)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (r *ProxyRepo) ValidateApiKey(ctx context.Context, key string) (*db.ApiKey, error) {
	rkey := "sk-" + key
	data, err := r.redis.Get(ctx, rkey).Result()
	if err == nil {
		key := db.ApiKey{}
		if err := json.Unmarshal([]byte(data), &key); err != nil {
			return nil, err
		}
		return &key, nil
	}

	if !errors.Is(err, redis.Nil) {
		return nil, err
	}

	a, err := r.db.ApiKey.Query().
		Where(apikey.Key(key), apikey.Status(consts.ApiKeyStatusActive)).
		Only(ctx)
	if err != nil {
		return nil, err
	}

	b, err := json.Marshal(a)
	if err != nil {
		return nil, err
	}

	if err := r.redis.Set(ctx, rkey, string(b), 24*time.Hour).Err(); err != nil {
		return nil, err
	}

	return a, nil
}

func (r *ProxyRepo) Record(ctx context.Context, record *domain.RecordParam) error {
	ctx = rule.SkipPermission(ctx)
	if record.TaskID == "" {
		return fmt.Errorf("task_id is empty")
	}
	userID, err := uuid.Parse(record.UserID)
	if err != nil {
		return err
	}
	modelID, err := uuid.Parse(record.ModelID)
	if err != nil {
		return err
	}

	return entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		isNew := false
		t, err := tx.Task.Query().ForUpdate().Where(task.TaskID(record.TaskID)).Only(ctx)
		if db.IsNotFound(err) {
			t, err = tx.Task.Create().
				SetTaskID(record.TaskID).
				SetRequestID(record.RequestID).
				SetUserID(userID).
				SetModelID(modelID).
				SetProgramLanguage(record.ProgramLanguage).
				SetInputTokens(record.InputTokens).
				SetOutputTokens(record.OutputTokens).
				SetIsAccept(record.IsAccept).
				SetModelType(record.ModelType).
				SetWorkMode(record.WorkMode).
				SetPrompt(record.Prompt).
				SetCodeLines(record.CodeLines).
				SetSourceCode(record.SourceCode).
				SetCursorPosition(record.CursorPosition).
				SetUserInput(record.UserInput).
				Save(ctx)
			isNew = true
		}
		if err != nil {
			return err
		}
		if !isNew {
			up := tx.Task.UpdateOneID(t.ID)
			if record.OutputTokens > 0 {
				up.AddOutputTokens(record.OutputTokens)
			}
			if t.CodeLines > 0 {
				up.AddCodeLines(record.CodeLines)
			}
			if t.RequestID != record.RequestID {
				up.SetRequestID(record.RequestID)
				up.AddInputTokens(record.InputTokens)
			}
			// 更新新字段，如果提供了的话
			if record.SourceCode != "" {
				up.SetSourceCode(record.SourceCode)
			}
			if record.Prompt != "" {
				up.SetPrompt(record.Prompt)
			}
			if record.CursorPosition != nil {
				up.SetCursorPosition(record.CursorPosition)
			}
			if record.UserInput != "" {
				up.SetUserInput(record.UserInput)
			}
			if err := up.Exec(ctx); err != nil {
				return err
			}
		}

		if record.Role == consts.ChatRoleUser {
			count, err := tx.TaskRecord.Query().
				Where(
					taskrecord.TaskID(t.ID),
					taskrecord.Role(consts.ChatRoleUser),
					taskrecord.Prompt(record.Prompt),
				).
				Count(ctx)
			if err != nil {
				return err
			}
			if count > 0 {
				return nil
			}
		}

		_, err = tx.TaskRecord.Create().
			SetTaskID(t.ID).
			SetRole(record.Role).
			SetPrompt(record.Prompt).
			SetCompletion(record.Completion).
			SetOutputTokens(record.OutputTokens).
			SetCodeLines(record.CodeLines).
			SetCode(record.Code).
			Save(ctx)

		return err
	})
}

func (r *ProxyRepo) UpdateByTaskID(ctx context.Context, taskID string, fn func(*db.TaskUpdateOne)) error {
	rc, err := r.db.Task.Query().Where(task.TaskID(taskID)).Only(ctx)
	if err != nil {
		return err
	}

	return entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		up := tx.Task.UpdateOneID(rc.ID)
		fn(up)
		return up.Exec(ctx)
	})
}

func (r *ProxyRepo) AcceptCompletion(ctx context.Context, req *domain.AcceptCompletionReq) error {
	return entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		rc, err := tx.Task.Query().Where(task.TaskID(req.ID)).Only(ctx)
		if err != nil {
			return err
		}

		if err := tx.Task.UpdateOneID(rc.ID).
			SetIsAccept(true).
			SetCompletion(req.Completion).
			Exec(ctx); err != nil {
			return err
		}

		return tx.TaskRecord.Update().
			Where(taskrecord.TaskID(rc.ID)).
			SetCompletion(req.Completion).Exec(ctx)
	})
}

// abs 返回整数的绝对值
func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

func (r *ProxyRepo) Report(ctx context.Context, model *db.Model, req *domain.ReportReq) error {
	return entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		rc, err := tx.Task.Query().Where(task.TaskID(req.ID)).Only(ctx)
		if err != nil {
			if req.Action == consts.ReportActionNewTask && db.IsNotFound(err) {
				uid, err := uuid.Parse(req.UserID)
				if err != nil {
					return err
				}
				newTask, err := tx.Task.Create().
					SetTaskID(req.ID).
					SetRequestID(uuid.NewString()).
					SetUserID(uid).
					SetModelID(model.ID).
					SetModelType(model.ModelType).
					SetWorkMode(req.Mode).
					SetPrompt(req.Content).
					Save(ctx)
				if err != nil {
					return err
				}
				rc = newTask
			} else {
				return err
			}
		}

		switch req.Action {
		case consts.ReportActionNewTask, consts.ReportActionFeedbackTask:
			if err := tx.TaskRecord.Create().
				SetTaskID(rc.ID).
				SetRole(consts.ChatRoleUser).
				SetPrompt(req.Content).
				Exec(ctx); err != nil {
				return err
			}

		case consts.ReportActionAbortTask:
			if err := tx.TaskRecord.Create().
				SetTaskID(rc.ID).
				SetRole(consts.ChatRoleSystem).
				SetCompletion(req.Content).
				Exec(ctx); err != nil {
				return err
			}

		case consts.ReportActionAccept:
			if err := tx.Task.UpdateOneID(rc.ID).
				SetIsAccept(true).
				SetCompletion(req.Content).
				Exec(ctx); err != nil {
				return err
			}

			return tx.TaskRecord.Update().
				Where(taskrecord.TaskID(rc.ID)).
				SetCompletion(req.Content).Exec(ctx)

		case consts.ReportActionSuggest:
			if err := tx.Task.UpdateOneID(rc.ID).
				SetIsSuggested(true).
				SetCompletion(req.Content).
				Exec(ctx); err != nil {
				return err
			}

			return tx.TaskRecord.Update().
				Where(taskrecord.TaskID(rc.ID)).
				SetCompletion(req.Content).Exec(ctx)

		case consts.ReportActionReject:
			if err := r.handleRejectCompletion(ctx, tx, rc, req); err != nil {
				return err
			}

		case consts.ReportActionFileWritten:
			if err := r.handleFileWritten(ctx, tx, rc, req); err != nil {
				return err
			}
		}

		return nil
	})
}

func (r *ProxyRepo) handleRejectCompletion(ctx context.Context, tx *db.Tx, rc *db.Task, req *domain.ReportReq) error {
	// 检测用户是否在同样的光标位置输入了新代码
	// 1. 检查光标位置是否匹配
	// 2. 检查源代码是否发生了变化
	// 3. 只有在检测到变化时才记录用户输入

	shouldRecord := false

	// 检查光标位置是否匹配（允许小的误差）
	if req.CursorPosition != nil && rc.CursorPosition != nil {
		// 从JSON中提取position值进行比较
		reqPos, reqOk := req.CursorPosition["position"].(float64)
		rcPos, rcOk := rc.CursorPosition["position"].(float64)

		if reqOk && rcOk {
			positionDiff := abs(int64(reqPos) - int64(rcPos))
			if positionDiff <= 10 { // 允许10个字符的误差
				shouldRecord = true
			}
		}
	}

	// 检查源代码是否发生了变化
	if req.SourceCode != "" && rc.SourceCode != "" {
		if req.SourceCode != rc.SourceCode {
			shouldRecord = true
		}
	}

	// 如果检测到变化，记录用户输入
	if shouldRecord && req.UserInput != "" {
		if err := tx.Task.UpdateOneID(rc.ID).
			SetUserInput(req.UserInput).
			Exec(ctx); err != nil {
			return err
		}
	}

	return nil
}

func (r *ProxyRepo) handleFileWritten(ctx context.Context, tx *db.Tx, rc *db.Task, req *domain.ReportReq) error {
	lineCount := 0
	switch req.Tool {
	case "appliedDiff", "editedExistingFile", "insertContent":
		if strings.Contains(req.Content, "<<<<<<<") {
			lines := diff.ParseConflictsAndCountLines(req.Content)
			for _, line := range lines {
				lineCount += line
			}
		} else {
			lineCount = strings.Count(req.Content, "\n")
		}
	case "newFileCreated":
		lineCount = strings.Count(req.Content, "\n")
	}

	if lineCount > 0 {
		if err := tx.Task.
			UpdateOneID(rc.ID).
			AddCodeLines(int64(lineCount)).
			SetIsAccept(true).
			Exec(ctx); err != nil {
			return err
		}
	}

	if req.Content != "" {
		if _, err := tx.TaskRecord.Create().
			SetTaskID(rc.ID).
			SetRole(consts.ChatRoleSystem).
			SetPrompt("写入文件").
			SetCompletion("").
			SetCodeLines(int64(lineCount)).
			SetCode(req.Content).
			SetOutputTokens(0).
			Save(ctx); err != nil {
			return err
		}
	}

	return nil
}
