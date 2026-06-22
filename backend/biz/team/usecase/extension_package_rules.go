package usecase

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/agentrule"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type extensionRuleImporter struct {
	db *db.Client
}

func (i *extensionRuleImporter) ImportRules(ctx context.Context, userID uuid.UUID, pkg *parsedExtensionPackage) (domain.ExtensionRuleImportResult, error) {
	var result domain.ExtensionRuleImportResult
	for _, item := range pkg.Rules {
		created, err := i.importRule(ctx, userID, pkg, item)
		if err != nil {
			return result, err
		}
		if created {
			result.CreatedRules++
		} else {
			result.UpdatedRules++
		}
	}
	return result, nil
}

func (i *extensionRuleImporter) importRule(ctx context.Context, userID uuid.UUID, pkg *parsedExtensionPackage, item parsedExtensionRule) (bool, error) {
	existingBySource, err := i.db.AgentRule.Query().
		Where(
			agentrule.ExtensionPackageIDEQ(pkg.PackageID),
			agentrule.ExtensionRuleIDEQ(item.RuleID),
			agentrule.IsDeletedEQ(false),
		).
		Only(ctx)
	if err != nil && !db.IsNotFound(err) {
		return false, err
	}
	if existingBySource != nil {
		version, err := i.createRuleVersion(ctx, existingBySource.ID, pkg.Version, item.Content)
		if err != nil {
			return false, err
		}
		_, err = i.db.AgentRule.UpdateOneID(existingBySource.ID).
			SetDescription(item.Description).
			SetExtensionVersion(pkg.Version).
			SetActiveVersionID(version.ID).
			Save(ctx)
		return false, err
	}

	conflict, err := i.db.AgentRule.Query().
		Where(
			agentrule.NameEQ(item.Name),
			agentrule.ScopeTypeEQ("global"),
			agentrule.ScopeIDEQ("global"),
			agentrule.IsDeletedEQ(false),
		).
		Exist(ctx)
	if err != nil {
		return false, err
	}
	if conflict {
		return false, errcode.ErrBadRequest.Wrap(fmt.Errorf("agent rule name conflict: %s", item.Name))
	}

	rule, err := i.db.AgentRule.Create().
		SetID(uuid.New()).
		SetName(item.Name).
		SetDescription(item.Description).
		SetScopeType("global").
		SetScopeID("global").
		SetCreatedBy(userID).
		SetExtensionPackageID(pkg.PackageID).
		SetExtensionRuleID(item.RuleID).
		SetExtensionVersion(pkg.Version).
		Save(ctx)
	if err != nil {
		return false, err
	}
	version, err := i.createRuleVersion(ctx, rule.ID, pkg.Version, item.Content)
	if err != nil {
		return false, err
	}
	_, err = i.db.AgentRule.UpdateOneID(rule.ID).SetActiveVersionID(version.ID).Save(ctx)
	return true, err
}

func (i *extensionRuleImporter) createRuleVersion(ctx context.Context, ruleID uuid.UUID, version, content string) (*db.AgentRuleVersion, error) {
	if len(version) > 14 {
		version = version[:14]
	}
	return i.db.AgentRuleVersion.Create().
		SetID(uuid.New()).
		SetRuleID(ruleID).
		SetVersion(version).
		SetContent(content).
		Save(ctx)
}
