package usecase

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentrule"
	"github.com/chaitin/MonkeyCode/backend/db/agentruleversion"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type extensionRuleImporter struct {
	db *db.Client
}

// VersionFormat is the time layout for rule version identifiers: yyyymmddhhmmss.
const VersionFormat = "20060102150405"

func (i *extensionRuleImporter) ImportRules(ctx context.Context, userID uuid.UUID, pkg *parsedExtensionPackage) (domain.ExtensionRuleImportResult, error) {
	// 防止并发导入将同一个包的两批规则混在一起。
	tx, err := i.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return domain.ExtensionRuleImportResult{}, err
	}
	defer tx.Rollback()

	result, err := i.replaceRules(ctx, tx, userID, pkg)
	if err != nil {
		return domain.ExtensionRuleImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ExtensionRuleImportResult{}, err
	}
	return result, nil
}

func (i *extensionRuleImporter) replaceRules(ctx context.Context, tx *db.Tx, userID uuid.UUID, pkg *parsedExtensionPackage) (domain.ExtensionRuleImportResult, error) {
	var result domain.ExtensionRuleImportResult
	source := agentrule.ExtensionPackageIDEQ(pkg.PackageID)
	rules, err := tx.AgentRule.Query().
		Where(source).
		Where(globalRulePredicates()...).
		WithVersions().
		All(ctx)
	if err != nil {
		return domain.ExtensionRuleImportResult{}, err
	}
	existing := make(map[string]*db.AgentRule, len(rules))
	for _, rule := range rules {
		if !rule.IsDeleted && rule.ExtensionRuleID != nil {
			existing[*rule.ExtensionRuleID] = rule
		}
	}
	if len(rules) == len(pkg.Rules) && extensionRulesMatch(existing, pkg) {
		return result, nil
	}

	// 生效版本与规则互相引用，先解除引用再清理历史版本。
	if err := tx.AgentRule.Update().
		Where(source).
		Where(globalRulePredicates()...).
		ClearActiveVersionID().
		Exec(ctx); err != nil {
		return domain.ExtensionRuleImportResult{}, err
	}
	if _, err := tx.AgentRuleVersion.Delete().
		Where(agentruleversion.HasRuleWith(source)).
		Where(agentruleversion.HasRuleWith(globalRulePredicates()...)).
		Exec(ctx); err != nil {
		return domain.ExtensionRuleImportResult{}, err
	}
	if _, err := tx.AgentRule.Delete().
		Where(source).
		Where(globalRulePredicates()...).
		Exec(ctx); err != nil {
		return domain.ExtensionRuleImportResult{}, err
	}
	for _, item := range pkg.Rules {
		previous := existing[item.RuleID]
		if err := i.importRule(ctx, tx, userID, pkg, item, previous); err != nil {
			return domain.ExtensionRuleImportResult{}, err
		}
		if previous == nil {
			result.CreatedRules++
		} else {
			result.UpdatedRules++
		}
	}
	return result, nil
}

func extensionRulesMatch(existing map[string]*db.AgentRule, pkg *parsedExtensionPackage) bool {
	if len(existing) != len(pkg.Rules) {
		return false
	}
	for _, item := range pkg.Rules {
		rule := existing[item.RuleID]
		if rule == nil || rule.Name != item.Name || rule.Description != item.Description {
			return false
		}
		if rule.ScopeType != agentrule.ScopeTypeGlobal || rule.ScopeID != globalRuleScopeID || rule.ExtensionVersion == nil || *rule.ExtensionVersion != pkg.Version {
			return false
		}
		versions := rule.Edges.Versions
		if rule.ActiveVersionID == nil || len(versions) != 1 || versions[0].ID != *rule.ActiveVersionID || versions[0].Content != item.Content {
			return false
		}
	}
	return true
}

func (i *extensionRuleImporter) importRule(ctx context.Context, tx *db.Tx, userID uuid.UUID, pkg *parsedExtensionPackage, item parsedExtensionRule, previous *db.AgentRule) error {
	conflict, err := tx.AgentRule.Query().
		Where(
			agentrule.NameEQ(item.Name),
			agentrule.IsDeletedEQ(false),
		).
		Where(globalRulePredicates()...).
		Exist(ctx)
	if err != nil {
		return err
	}
	if conflict {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("agent rule name conflict: %s", item.Name))
	}

	create := tx.AgentRule.Create().
		SetID(uuid.New()).
		SetName(item.Name).
		SetDescription(item.Description).
		SetScopeType(agentrule.ScopeTypeGlobal).
		SetScopeID(globalRuleScopeID).
		SetCreatedBy(userID).
		SetExtensionPackageID(pkg.PackageID).
		SetExtensionRuleID(item.RuleID).
		SetExtensionVersion(pkg.Version)
	if previous != nil {
		create.SetID(previous.ID).SetCreatedAt(previous.CreatedAt).SetCreatedBy(previous.CreatedBy)
	}
	rule, err := create.Save(ctx)
	if err != nil {
		return err
	}
	version, err := i.createRuleVersion(ctx, tx, rule.ID, item.Content)
	if err != nil {
		return err
	}
	return tx.AgentRule.UpdateOneID(rule.ID).
		Where(aliveGlobalRulePredicates(rule.ID)...).
		SetActiveVersionID(version.ID).
		Exec(ctx)
}

func (i *extensionRuleImporter) createRuleVersion(ctx context.Context, tx *db.Tx, ruleID uuid.UUID, content string) (*db.AgentRuleVersion, error) {
	now := time.Now()
	version := now.UTC().Format(VersionFormat)
	return tx.AgentRuleVersion.Create().
		SetID(uuid.New()).
		SetRuleID(ruleID).
		SetVersion(version).
		SetContent(content).
		SetCreatedAt(now).
		Save(ctx)
}
