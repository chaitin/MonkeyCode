package usecase

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentrule"
	"github.com/chaitin/MonkeyCode/backend/db/agentruleversion"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

const maxRuleContentBytes = 1 << 20

const globalRuleScopeID = "global"

func globalRulePredicates() []predicate.AgentRule {
	return []predicate.AgentRule{
		agentrule.ScopeTypeEQ(agentrule.ScopeTypeGlobal),
		agentrule.ScopeIDEQ(globalRuleScopeID),
	}
}

func aliveGlobalRulePredicates(id uuid.UUID) []predicate.AgentRule {
	preds := globalRulePredicates()
	return append(preds, agentrule.IDEQ(id), agentrule.IsDeletedEQ(false))
}

type teamRuleUsecase struct {
	db *db.Client
}

func NewTeamRuleUsecase(i *do.Injector) (domain.TeamRuleUsecase, error) {
	return &teamRuleUsecase{db: do.MustInvoke[*db.Client](i)}, nil
}

func (u *teamRuleUsecase) List(ctx context.Context, _ *domain.TeamUser) (*domain.ListTeamRulesResp, error) {
	rules, err := u.db.AgentRule.Query().
		Where(agentrule.IsDeletedEQ(false)).
		Where(globalRulePredicates()...).
		Order(db.Desc(agentrule.FieldUpdatedAt)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.TeamRule, 0, len(rules))
	for _, rule := range rules {
		dto, err := u.toDTO(ctx, rule)
		if err != nil {
			return nil, err
		}
		out = append(out, dto)
	}
	return &domain.ListTeamRulesResp{Rules: out}, nil
}

func (u *teamRuleUsecase) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamRuleReq) (*domain.TeamRule, error) {
	name, err := validateRuleName(req.Name)
	if err != nil {
		return nil, err
	}
	content, err := validateRuleContent(req.Content)
	if err != nil {
		return nil, err
	}
	userID := teamUser.User.ID
	var createdID uuid.UUID
	err = entx.WithTx2(ctx, u.db, func(tx *db.Tx) error {
		rule, err := tx.AgentRule.Create().
			SetName(name).
			SetDescription(strings.TrimSpace(req.Description)).
			SetScopeType(agentrule.ScopeTypeGlobal).
			SetScopeID(globalRuleScopeID).
			SetCreatedBy(userID).
			SetEnabled(true).
			SetIsDeleted(false).
			Save(ctx)
		if err != nil {
			if db.IsConstraintError(err) {
				return errcode.ErrBadRequest.Wrap(fmt.Errorf("rule name already exists: %s", name))
			}
			return err
		}
		version, err := tx.AgentRuleVersion.Create().
			SetRuleID(rule.ID).
			SetVersion(time.Now().UTC().Format(VersionFormat)).
			SetContent(content).
			Save(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.AgentRule.UpdateOneID(rule.ID).SetActiveVersionID(version.ID).Save(ctx); err != nil {
			return err
		}
		createdID = rule.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return u.loadDTO(ctx, createdID)
}

func (u *teamRuleUsecase) Update(ctx context.Context, _ *domain.TeamUser, req *domain.UpdateTeamRuleReq) (*domain.TeamRule, error) {
	rule, err := u.getAlive(ctx, req.RuleID)
	if err != nil {
		return nil, err
	}
	name := rule.Name
	if strings.TrimSpace(req.Name) != "" {
		name, err = validateRuleName(req.Name)
		if err != nil {
			return nil, err
		}
	}
	description := rule.Description
	if req.Description != nil {
		description = strings.TrimSpace(*req.Description)
	}
	contentChanged := strings.TrimSpace(req.Content) != ""
	var content string
	if contentChanged {
		content, err = validateRuleContent(req.Content)
		if err != nil {
			return nil, err
		}
	}
	err = entx.WithTx2(ctx, u.db, func(tx *db.Tx) error {
		update := tx.AgentRule.UpdateOneID(rule.ID).
			Where(aliveGlobalRulePredicates(rule.ID)...).
			SetName(name).
			SetDescription(description)
		if _, err := update.Save(ctx); err != nil {
			if db.IsConstraintError(err) {
				return errcode.ErrBadRequest.Wrap(fmt.Errorf("rule name already exists: %s", name))
			}
			return err
		}
		if !contentChanged {
			return nil
		}
		version, err := tx.AgentRuleVersion.Create().
			SetRuleID(rule.ID).
			SetVersion(time.Now().UTC().Format(VersionFormat)).
			SetContent(content).
			Save(ctx)
		if err != nil {
			return err
		}
		_, err = tx.AgentRule.UpdateOneID(rule.ID).SetActiveVersionID(version.ID).Save(ctx)
		return err
	})
	if err != nil {
		return nil, err
	}
	return u.loadDTO(ctx, rule.ID)
}

func (u *teamRuleUsecase) SetEnabled(ctx context.Context, _ *domain.TeamUser, req *domain.SetTeamRuleEnabledReq) (*domain.TeamRule, error) {
	if _, err := u.getAlive(ctx, req.RuleID); err != nil {
		return nil, err
	}
	if _, err := u.db.AgentRule.UpdateOneID(req.RuleID).
		Where(aliveGlobalRulePredicates(req.RuleID)...).
		SetEnabled(req.Enabled).
		Save(ctx); err != nil {
		return nil, err
	}
	return u.loadDTO(ctx, req.RuleID)
}

func (u *teamRuleUsecase) Delete(ctx context.Context, _ *domain.TeamUser, req *domain.DeleteTeamRuleReq) error {
	if _, err := u.getAlive(ctx, req.RuleID); err != nil {
		return err
	}
	_, err := u.db.AgentRule.UpdateOneID(req.RuleID).
		Where(aliveGlobalRulePredicates(req.RuleID)...).
		SetIsDeleted(true).
		Save(ctx)
	return err
}

func (u *teamRuleUsecase) ListVersions(ctx context.Context, _ *domain.TeamUser, req *domain.ListTeamRuleVersionsReq) (*domain.ListTeamRuleVersionsResp, error) {
	if _, err := u.getAlive(ctx, req.RuleID); err != nil {
		return nil, err
	}
	versions, err := u.db.AgentRuleVersion.Query().
		Where(agentruleversion.RuleIDEQ(req.RuleID)).
		Order(db.Desc(agentruleversion.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]*domain.TeamRuleVersion, 0, len(versions))
	for _, v := range versions {
		out = append(out, &domain.TeamRuleVersion{
			ID:        v.ID,
			Version:   v.Version,
			CreatedAt: v.CreatedAt.Unix(),
		})
	}
	return &domain.ListTeamRuleVersionsResp{Versions: out}, nil
}

func (u *teamRuleUsecase) Restore(ctx context.Context, _ *domain.TeamUser, req *domain.RestoreTeamRuleReq) (*domain.TeamRule, error) {
	if _, err := u.getAlive(ctx, req.RuleID); err != nil {
		return nil, err
	}
	version, err := u.db.AgentRuleVersion.Query().
		Where(
			agentruleversion.IDEQ(req.VersionID),
			agentruleversion.RuleIDEQ(req.RuleID),
		).
		Only(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound.Wrap(fmt.Errorf("rule version not found"))
		}
		return nil, err
	}
	if _, err := u.db.AgentRule.UpdateOneID(req.RuleID).
		Where(aliveGlobalRulePredicates(req.RuleID)...).
		SetActiveVersionID(version.ID).
		Save(ctx); err != nil {
		return nil, err
	}
	return u.loadDTO(ctx, req.RuleID)
}

func (u *teamRuleUsecase) getAlive(ctx context.Context, id uuid.UUID) (*db.AgentRule, error) {
	rule, err := u.db.AgentRule.Query().
		Where(aliveGlobalRulePredicates(id)...).
		Only(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound.Wrap(fmt.Errorf("rule not found"))
		}
		return nil, err
	}
	return rule, nil
}

func (u *teamRuleUsecase) loadDTO(ctx context.Context, id uuid.UUID) (*domain.TeamRule, error) {
	rule, err := u.getAlive(ctx, id)
	if err != nil {
		return nil, err
	}
	return u.toDTO(ctx, rule)
}

func (u *teamRuleUsecase) toDTO(ctx context.Context, rule *db.AgentRule) (*domain.TeamRule, error) {
	dto := &domain.TeamRule{
		ID:          rule.ID,
		Name:        rule.Name,
		Description: rule.Description,
		Enabled:     rule.Enabled,
		CreatedAt:   rule.CreatedAt.Unix(),
		UpdatedAt:   rule.UpdatedAt.Unix(),
	}
	if rule.ActiveVersionID == nil {
		return dto, nil
	}
	version, err := u.db.AgentRuleVersion.Get(ctx, *rule.ActiveVersionID)
	if err != nil {
		if db.IsNotFound(err) {
			return dto, nil
		}
		return nil, err
	}
	dto.Content = version.Content
	dto.ActiveVersion = version.Version
	return dto, nil
}

func validateRuleName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("rule name is required"))
	}
	if strings.ContainsAny(name, `/\:*?"<>|`) || strings.Contains(name, "..") {
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("rule name contains path characters"))
	}
	for _, r := range name {
		if r < 32 {
			return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("rule name contains control characters"))
		}
	}
	if utf8.RuneCountInString(name) > 128 {
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("rule name is too long"))
	}
	return name, nil
}

func validateRuleContent(content string) (string, error) {
	if strings.TrimSpace(content) == "" {
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("rule content is required"))
	}
	if len(content) > maxRuleContentBytes {
		return "", errcode.ErrBadRequest.Wrap(fmt.Errorf("rule content exceeds 1 MiB"))
	}
	return content, nil
}
