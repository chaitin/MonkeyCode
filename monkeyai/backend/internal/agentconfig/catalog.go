package agentconfig

import (
	"context"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/agentconfig/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func (r *Resources) tags(ctx context.Context, q resource.Queryer, kind string, ids []string) (map[string][]resource.Object, error) {
	out := make(map[string][]resource.Object, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	for _, id := range ids {
		out[id] = []resource.Object{}
	}
	rows, err := sqlc.New(q).CatalogTags(ctx, sqlc.CatalogTagsParams{ResourceType: strings.TrimSuffix(kind, "s"), ResourceIds: ids})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.ResourceID] = append(out[row.ResourceID], resource.Object{"id": row.ID, "name": row.Name})
	}
	return out, nil
}

type catalogPage struct {
	ResourceIds []string
	TotalCount  int64
}

func (r *Resources) page(ctx context.Context, q resource.Queryer, user, kind string, filter resource.CatalogFilter, tags []string, page, size int) (catalogPage, error) {
	system, err := resource.CanUseSystem(ctx, q, user)
	if err != nil {
		return catalogPage{}, err
	}
	queries := sqlc.New(q)
	grants, err := r.grants(ctx, q, user, kind)
	if err != nil {
		return catalogPage{}, err
	}
	resourceType := strings.TrimSuffix(kind, "s")
	ids := []string{}
	for _, grant := range grants {
		if grant.String("kind") == resourceType {
			ids = append(ids, grant.String("id"))
		}
	}
	args := sqlc.CatalogRulesPageParams{
		ResourceType: resourceType, SystemAccess: system, UserID: user, GrantedIds: ids,
		OwnerFilter: filter.Owner, SearchQuery: strings.ToLower(filter.Query), TagIds: tags,
		PageOffset: int32((page - 1) * size), PageSize: int32(size),
	}
	switch kind {
	case "rules":
		row, err := queries.CatalogRulesPage(ctx, args)
		return catalogPage(row), err
	case "skills":
		row, err := queries.CatalogSkillsPage(ctx, sqlc.CatalogSkillsPageParams(args))
		return catalogPage(row), err
	case "experts":
		row, err := queries.CatalogExpertsPage(ctx, sqlc.CatalogExpertsPageParams(args))
		return catalogPage(row), err
	case "connectors":
		row, err := queries.CatalogConnectorsPage(ctx, sqlc.CatalogConnectorsPageParams(args))
		return catalogPage(row), err
	default:
		return catalogPage{}, resource.NotFound
	}
}
