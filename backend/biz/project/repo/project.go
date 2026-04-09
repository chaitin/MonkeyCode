package repo

import (
	"context"
	"log/slog"
	"slices"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/db/project"
	"github.com/chaitin/MonkeyCode/backend/db/projectcollaborator"
	"github.com/chaitin/MonkeyCode/backend/db/projectissue"
	"github.com/chaitin/MonkeyCode/backend/db/projectissuecomment"
	"github.com/chaitin/MonkeyCode/backend/db/projecttask"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// ProjectRepo 项目数据访问层
type ProjectRepo struct {
	db     *db.Client
	logger *slog.Logger
}

// NewProjectRepo 创建项目数据访问层
func NewProjectRepo(i *do.Injector) (domain.ProjectRepo, error) {
	return &ProjectRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i).With("module", "repo.ProjectRepo"),
	}, nil
}

func (r *ProjectRepo) getProjectQuery(uid uuid.UUID) predicate.Project {
	return project.Or(
		project.UserID(uid),
		project.HasCollaboratorsWith(projectcollaborator.UserID(uid)),
	)
}

// Get 获取项目
func (r *ProjectRepo) Get(ctx context.Context, uid, id uuid.UUID) (*db.Project, error) {
	return r.db.Project.Query().
		Where(
			project.ID(id),
			r.getProjectQuery(uid),
		).
		WithGitIdentity().
		WithCollaborators(func(pq *db.ProjectCollaboratorQuery) {
			pq.WithUser()
		}).
		WithUser().
		WithIssues(func(piq *db.ProjectIssueQuery) {
			piq.WithUser()
		}).
		WithGitBots().
		First(ctx)
}

// GetByID 根据 ID 获取项目
func (r *ProjectRepo) GetByID(ctx context.Context, id uuid.UUID) (*db.Project, error) {
	return r.db.Project.Query().
		Where(project.IDEQ(id)).
		WithImage().
		First(ctx)
}

// List 列出用户的所有项目
func (r *ProjectRepo) List(ctx context.Context, uid uuid.UUID, cursor domain.CursorReq) ([]*db.Project, *db.Cursor, error) {
	projects, cur, err := r.db.Project.Query().
		Where(r.getProjectQuery(uid)).
		WithUser().
		WithCollaborators(func(pq *db.ProjectCollaboratorQuery) {
			pq.WithUser()
		}).
		WithIssues(func(piq *db.ProjectIssueQuery) {
			piq.Where(projectissue.StatusEQ(consts.ProjectIssueStatusOpen))
		}).
		WithProjectTasks(func(ptq *db.ProjectTaskQuery) {
			ptq.
				WithTask().
				Where(projecttask.HasTaskWith(task.And(
					task.DeletedAtIsNil(),
					task.UserID(uid),
					task.StatusIn(consts.TaskStatusPending, consts.TaskStatusProcessing),
				))).
				Order(projecttask.ByCreatedAt(sql.OrderDesc()))
		}).
		WithGitBots().
		After(ctx, cursor.Cursor, cursor.Limit)
	if err != nil {
		return nil, nil, err
	}
	for _, p := range projects {
		if len(p.Edges.ProjectTasks) > 3 {
			p.Edges.ProjectTasks = p.Edges.ProjectTasks[:3]
		}
	}
	return projects, cur, nil
}

// Create 创建项目
func (r *ProjectRepo) Create(ctx context.Context, uid uuid.UUID, req *domain.CreateProjectReq) (*db.Project, error) {
	var projectID uuid.UUID
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		p, err := tx.Project.Create().
			SetName(req.Name).
			SetDescription(req.Description).
			SetUserID(uid).
			Save(ctx)
		if err != nil {
			return err
		}
		_, err = tx.ProjectCollaborator.Create().
			SetProjectID(p.ID).
			SetUserID(uid).
			SetRole(consts.ProjectCollaboratorRoleReadWrite).
			Save(ctx)
		if err != nil {
			return err
		}
		upt := tx.Project.UpdateOneID(p.ID).
			SetGitIdentityID(req.GitIdentityID).
			SetPlatform(req.Platform).
			SetRepoURL(req.RepoURL)
		if req.EnvVariables != nil {
			upt.SetEnvVariables(req.EnvVariables)
		}
		if req.ImageID != uuid.Nil {
			upt.SetImageID(req.ImageID)
		}
		err = upt.Exec(ctx)
		if err != nil {
			return err
		}
		projectID = p.ID
		return nil
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to create project", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.db.Project.Query().Where(project.IDEQ(projectID)).First(ctx)
}

// Update 更新项目
func (r *ProjectRepo) Update(ctx context.Context, u *domain.User, req *domain.UpdateProjectReq) (*db.Project, error) {
	teamIDs := []uuid.UUID{}
	err := r.db.TeamMember.Query().
		Where(teammember.UserIDIn(u.ID)).
		Select(teammember.FieldTeamID).
		Scan(ctx, &teamIDs)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to query team members", "error", err)
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}

	err = entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		p, err := tx.Project.Query().
			Where(project.ID(req.ID), r.getProjectQuery(u.ID)).
			ForUpdate().
			First(ctx)
		if err != nil {
			if db.IsNotFound(err) {
				return errcode.ErrNotFound
			}
			return errcode.ErrDatabaseOperation.Wrap(err)
		}

		coo, err := tx.ProjectCollaborator.Query().
			Where(projectcollaborator.ProjectIDEQ(req.ID), projectcollaborator.UserIDEQ(u.ID)).
			ForUpdate().
			First(ctx)
		if err != nil {
			if db.IsNotFound(err) {
				return errcode.ErrForbidden
			}
			return errcode.ErrDatabaseOperation.Wrap(err)
		}
		if coo.Role != consts.ProjectCollaboratorRoleReadWrite {
			return errcode.ErrForbidden
		}

		if len(req.Collaborator) > 0 {
			collaboratorIDs := []uuid.UUID{}
			cvt.Iter(req.Collaborator, func(_ int, member *domain.CreateCollaboratorItem) *domain.CreateCollaboratorItem {
				if member.UserID != uuid.Nil {
					collaboratorIDs = append(collaboratorIDs, member.UserID)
				}
				return nil
			})
			for _, uid := range []uuid.UUID{u.ID, p.UserID} {
				if !slices.Contains(collaboratorIDs, uid) {
					collaboratorIDs = append(collaboratorIDs, uid)
				}
			}
			if len(collaboratorIDs) != 1 {
				memberIDs := []uuid.UUID{}
				err := tx.TeamMember.Query().
					Where(
						teammember.TeamIDIn(teamIDs...),
						teammember.UserIDIn(collaboratorIDs...),
					).
					Select(teammember.FieldUserID).
					Scan(ctx, &memberIDs)
				if err != nil {
					if db.IsNotFound(err) {
						return errcode.ErrNotFound
					}
					return errcode.ErrDatabaseQuery.Wrap(err)
				}
				if len(memberIDs) != len(req.Collaborator) {
					return errcode.ErrInvalidCollaborarator
				}
			}
		}

		upt := tx.Project.UpdateOneID(req.ID).
			Where(r.getProjectQuery(u.ID))
		if req.Name != "" {
			upt.SetName(req.Name)
		}
		if req.Description != "" {
			upt.SetDescription(req.Description)
		}
		if req.ImageID != uuid.Nil {
			upt.SetImageID(req.ImageID)
		}
		if req.EnvVariables != nil {
			upt.SetEnvVariables(req.EnvVariables)
		}
		err = upt.Exec(ctx)
		if err != nil {
			return err
		}

		if len(req.Collaborator) == 0 {
			return nil
		}
		_, err = tx.ProjectCollaborator.Delete().
			Where(projectcollaborator.ProjectID(req.ID)).
			Exec(ctx)
		if err != nil {
			return err
		}
		relBuilders := make([]*db.ProjectCollaboratorCreate, 0, len(req.Collaborator))
		for _, member := range req.Collaborator {
			if member.UserID == p.UserID && member.Permission == consts.ProjectCollaboratorRoleReadOnly {
				member.Permission = consts.ProjectCollaboratorRoleReadWrite
			}
			relBuilders = append(relBuilders, tx.ProjectCollaborator.Create().
				SetProjectID(req.ID).
				SetUserID(member.UserID).
				SetRole(member.Permission),
			)
		}
		_, err = tx.ProjectCollaborator.CreateBulk(relBuilders...).Save(ctx)
		return err
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to update project", "error", err)
		return nil, err
	}
	return r.db.Project.Query().
		Where(project.IDEQ(req.ID), r.getProjectQuery(u.ID)).
		WithCollaborators(func(pq *db.ProjectCollaboratorQuery) {
			pq.WithUser()
		}).
		WithUser().
		First(ctx)
}

// Delete 删除项目
func (r *ProjectRepo) Delete(ctx context.Context, uid, id uuid.UUID) error {
	p, err := r.db.Project.Query().Where(project.IDEQ(id)).First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return errcode.ErrNotFound
		}
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	if p.UserID != uid {
		return errcode.ErrForbidden
	}
	return entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		err := tx.Project.DeleteOneID(id).
			Where(r.getProjectQuery(uid)).
			Exec(ctx)
		if err != nil {
			if db.IsNotFound(err) {
				return errcode.ErrNotFound
			}
			return errcode.ErrDatabaseOperation.Wrap(err)
		}
		_, err = tx.ProjectCollaborator.Delete().
			Where(projectcollaborator.ProjectID(id)).
			Exec(ctx)
		if err != nil {
			return err
		}
		_, err = tx.ProjectIssueComment.Delete().
			Where(projectissuecomment.HasIssueWith(projectissue.ProjectID(id))).
			Exec(ctx)
		if err != nil {
			return err
		}
		_, err = tx.ProjectIssue.Delete().
			Where(projectissue.ProjectID(id)).
			Exec(ctx)
		return err
	})
}

// ListIssues 列出项目问题
func (r *ProjectRepo) ListIssues(ctx context.Context, uid uuid.UUID, req *domain.ListIssuesReq) ([]*db.ProjectIssue, *db.Cursor, error) {
	return r.db.ProjectIssue.Query().
		Where(projectissue.HasProjectWith(project.IDEQ(req.ID), r.getProjectQuery(uid))).
		WithUser().
		WithAssignee().
		After(ctx, req.Cursor, req.Limit)
}

// CreateIssue 创建问题
func (r *ProjectRepo) CreateIssue(ctx context.Context, uid uuid.UUID, req *domain.CreateIssueReq) (*db.ProjectIssue, error) {
	p, err := r.Get(ctx, uid, req.ID)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrForbidden
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	collaborator, err := r.db.ProjectCollaborator.Query().
		Where(projectcollaborator.ProjectIDEQ(req.ID), projectcollaborator.UserIDEQ(uid)).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	if collaborator.Role != consts.ProjectCollaboratorRoleReadWrite {
		return nil, errcode.ErrForbidden
	}
	var issueID uuid.UUID
	err = entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		create := tx.ProjectIssue.Create().
			SetProjectID(p.ID).
			SetTitle(req.Title).
			SetRequirementDocument(req.RequirementDocument).
			SetStatus(consts.ProjectIssueStatusOpen).
			SetUserID(uid)
		if req.Priority != 0 {
			create.SetPriority(req.Priority)
		}
		if req.AssigneeID != nil {
			create.SetAssigneeID(*req.AssigneeID)
		}
		issue, err := create.Save(ctx)
		if err != nil {
			return err
		}
		issueID = issue.ID
		return tx.Project.UpdateOneID(p.ID).SetUpdatedAt(time.Now()).Exec(ctx)
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to create project issue", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.db.ProjectIssue.Get(ctx, issueID)
}

// UpdateIssue 更新问题
func (r *ProjectRepo) UpdateIssue(ctx context.Context, uid uuid.UUID, req *domain.UpdateIssueReq) (*db.ProjectIssue, error) {
	p, err := r.Get(ctx, uid, req.ID)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	collaborator, err := r.db.ProjectCollaborator.Query().
		Where(projectcollaborator.ProjectIDEQ(req.ID), projectcollaborator.UserIDEQ(uid)).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrForbidden
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	if collaborator.Role != consts.ProjectCollaboratorRoleReadWrite {
		return nil, errcode.ErrForbidden
	}
	err = entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		upt := tx.ProjectIssue.UpdateOneID(req.IssueID).
			Where(projectissue.HasProjectWith(project.IDEQ(p.ID), r.getProjectQuery(uid)))
		if req.AssigneeID != nil {
			upt.SetAssigneeID(*req.AssigneeID)
		} else {
			upt.ClearAssigneeID()
		}
		if req.Title != "" {
			upt.SetTitle(req.Title)
		}
		if req.RequirementDocument != "" {
			upt.SetRequirementDocument(req.RequirementDocument)
		}
		if req.DesignDocument != "" {
			upt.SetDesignDocument(req.DesignDocument)
		}
		if req.Status != "" {
			upt.SetStatus(req.Status)
		}
		if req.Priority != 0 {
			upt.SetPriority(req.Priority)
		}
		if err := upt.Exec(ctx); err != nil {
			return err
		}
		return tx.Project.UpdateOneID(p.ID).SetUpdatedAt(time.Now()).Exec(ctx)
	})
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to update project issue", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.db.ProjectIssue.Get(ctx, req.IssueID)
}

// UpdateIssueDoc 更新问题文档
func (r *ProjectRepo) UpdateIssueDoc(ctx context.Context, req *domain.UpdateIssueDocReq) (*db.ProjectIssue, error) {
	upt := r.db.ProjectIssue.UpdateOneID(req.IssueID)
	if req.RequirementDocument != "" {
		upt.SetRequirementDocument(req.RequirementDocument)
	}
	if req.DesignDocument != "" {
		upt.SetDesignDocument(req.DesignDocument)
	}
	if err := upt.Exec(ctx); err != nil {
		r.logger.ErrorContext(ctx, "failed to update project issue doc", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.db.ProjectIssue.Get(ctx, req.IssueID)
}

// GetIssue 获取单个问题
func (r *ProjectRepo) GetIssue(ctx context.Context, uid uuid.UUID, projectID, issueID uuid.UUID) (*db.ProjectIssue, error) {
	issue, err := r.db.ProjectIssue.Query().
		Where(
			projectissue.IDEQ(issueID),
			projectissue.HasProjectWith(project.IDEQ(projectID), r.getProjectQuery(uid)),
		).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return issue, nil
}

// UpdateIssueSummary 更新问题摘要
func (r *ProjectRepo) UpdateIssueSummary(ctx context.Context, issueID uuid.UUID, summary string) error {
	err := r.db.ProjectIssue.UpdateOneID(issueID).SetSummary(summary).Exec(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to update issue summary", "issue_id", issueID, "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}

// ListCollaborators 列出项目协作者
func (r *ProjectRepo) ListCollaborators(ctx context.Context, uid uuid.UUID, req *domain.ListCollaboratorsReq) ([]*db.ProjectCollaborator, error) {
	return r.db.ProjectCollaborator.Query().
		Where(projectcollaborator.HasProjectWith(project.IDEQ(req.ID), r.getProjectQuery(uid))).
		WithUser().
		All(ctx)
}

// ListIssueComments 列出问题评论
func (r *ProjectRepo) ListIssueComments(ctx context.Context, uid uuid.UUID, req *domain.ListIssueCommentsReq) ([]*db.ProjectIssueComment, *db.Cursor, error) {
	return r.db.ProjectIssueComment.Query().
		Where(
			projectissuecomment.HasIssueWith(
				projectissue.IDEQ(req.IssueID),
				projectissue.HasProjectWith(project.IDEQ(req.ID), r.getProjectQuery(uid)),
			),
		).
		WithUser().
		WithIssue(func(piq *db.ProjectIssueQuery) {
			piq.WithUser()
		}).
		WithParent(func(picq *db.ProjectIssueCommentQuery) {
			picq.WithUser()
		}).
		Order(projectissuecomment.ByCreatedAt()).
		After(ctx, req.Cursor, req.Limit)
}

// CreateIssueComment 创建问题评论
func (r *ProjectRepo) CreateIssueComment(ctx context.Context, uid uuid.UUID, req *domain.CreateIssueCommentReq) (*db.ProjectIssueComment, error) {
	_, err := r.db.ProjectIssue.Query().
		Where(
			projectissue.IDEQ(req.IssueID),
			projectissue.HasProjectWith(project.IDEQ(req.ID), r.getProjectQuery(uid)),
		).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	create := r.db.ProjectIssueComment.Create().
		SetUserID(uid).
		SetIssueID(req.IssueID).
		SetComment(req.Comment)
	if req.ParentID != nil {
		create.SetParentID(*req.ParentID)
	}
	comment, err := create.Save(ctx)
	if err != nil {
		return nil, err
	}
	return r.db.ProjectIssueComment.Query().
		Where(projectissuecomment.IDEQ(comment.ID)).
		WithUser().
		WithParent().
		First(ctx)
}

// HasReadWritePerm 判断用户是否有读写权限
func (r *ProjectRepo) HasReadWritePerm(ctx context.Context, uid uuid.UUID, projectID uuid.UUID) bool {
	collaborator, err := r.db.ProjectCollaborator.Query().
		Where(projectcollaborator.ProjectIDEQ(projectID), projectcollaborator.UserIDEQ(uid)).
		First(ctx)
	if err != nil {
		return false
	}
	return collaborator.Role == consts.ProjectCollaboratorRoleReadWrite
}

// GetProjectIDByTask 根据 task_id 获取 project
func (r *ProjectRepo) GetProjectIDByTask(ctx context.Context, taskID string) (*db.Project, error) {
	tid, err := uuid.Parse(taskID)
	if err != nil {
		return nil, errcode.ErrInvalidParameter.Wrap(err)
	}
	pt, err := r.db.ProjectTask.Query().
		WithProject().
		Where(projecttask.TaskIDEQ(tid)).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	if pt.Edges.Project == nil {
		return nil, errcode.ErrNotFound
	}
	return pt.Edges.Project, nil
}

// GetIssueByTaskID 根据 task_id 获取 issue
func (r *ProjectRepo) GetIssueByTaskID(ctx context.Context, taskID string) (*db.ProjectIssue, error) {
	tid, err := uuid.Parse(taskID)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to parse task id", "error", err)
		return nil, errcode.ErrInvalidParameter.Wrap(err)
	}
	pt, err := r.db.ProjectTask.Query().
		Where(projecttask.TaskIDEQ(tid)).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		r.logger.ErrorContext(ctx, "failed to get project task", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	if pt.IssueID == uuid.Nil {
		r.logger.InfoContext(ctx, "task has no issue", "task_id", taskID)
		return nil, errcode.ErrInvalidParameter
	}
	issue, err := r.db.ProjectIssue.Query().
		Where(projectissue.IDEQ(pt.IssueID)).
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		r.logger.ErrorContext(ctx, "failed to get project issue", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return issue, nil
}

// GetUserProjectPerm 获取用户的项目权限
func (r *ProjectRepo) GetUserProjectPerm(ctx context.Context, uid uuid.UUID, projectID uuid.UUID) (consts.ProjectCollaboratorRole, error) {
	collaborator, err := r.db.ProjectCollaborator.Query().
		Where(projectcollaborator.ProjectIDEQ(projectID), projectcollaborator.UserIDEQ(uid)).
		First(ctx)
	if err != nil {
		return "", err
	}
	return collaborator.Role, nil
}
