package resource

import (
	"net/http"
	"strings"
)

type CatalogFilter struct {
	Query string
	Owner string
}

func ParseCatalogFilter(r *http.Request) (CatalogFilter, error) {
	owner := r.URL.Query().Get("owner")
	if owner == "" {
		owner = "all"
	}
	switch owner {
	case "all", "team", "mine", "shared":
	default:
		return CatalogFilter{}, Invalid("owner 必须为 all、team、mine 或 shared")
	}
	return CatalogFilter{Query: strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))), Owner: owner}, nil
}

func (f CatalogFilter) Matches(ownership, ownerID, userID, name, description string) bool {
	switch f.Owner {
	case "team":
		if ownership != "system" {
			return false
		}
	case "mine":
		if ownership != "user" || userID == "" || ownerID != userID {
			return false
		}
	case "shared":
		if ownership != "user" || ownerID == "" || ownerID == userID {
			return false
		}
	}
	query := strings.ToLower(f.Query)
	return query == "" || strings.Contains(strings.ToLower(name), query) || strings.Contains(strings.ToLower(description), query)
}
