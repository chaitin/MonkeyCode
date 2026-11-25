package agentconfig

import (
	"context"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type connectorSummary struct {
	version string
	ready   bool
}

func (c catalog) expertKnowledge(id, user string) ([]string, bool) {
	books := []string{}
	links := c.links[id+":expert_knowledge_bases"]
	for _, kb := range links {
		if c.allowed("kb", kb, user) {
			books = append(books, kb.String("id"))
		}
	}
	return books, len(books) != len(links)
}

func missingKnowledgeIssue() resource.Object {
	return resource.Object{"code": "knowledge_access_missing", "blocking": false}
}

func (r *Resources) expertSummary(ctx context.Context, q resource.Queryer, c catalog, id, user string) (resource.Object, error) {
	e := c.experts[id]
	if !c.allowed("expert", e, user) {
		return nil, resource.NotFound
	}
	versions := map[string]any{"expert": []any{id, e["revision"]}}
	issues := []resource.Object{}
	books, missing := c.expertKnowledge(id, user)
	if len(books) > 0 {
		versions["knowledge_base_ids"] = books
	}
	if missing {
		issues = append(issues, missingKnowledgeIssue())
	}
	available := true
	issue := func(code string, blocking bool, connector string) {
		v := resource.Object{"code": code, "blocking": blocking}
		if connector != "" {
			v["connector_id"] = connector
		}
		issues = append(issues, v)
		if blocking {
			available = false
		}
	}
	for _, link := range c.links[id+":expert_rules"] {
		key := link.String("rule_id")
		rule := c.rules[key]
		if rule == nil || !rule.Bool("enabled") || (e.String("ownership_type") == "user" && !c.allowed("rule", rule, user)) {
			issue("rule_missing", true, "")
			continue
		}
		versions["rule:"+key] = []any{rule["revision"], c.required[key]}
	}
	for _, link := range c.links[id+":expert_skills"] {
		key := link.String("skill_id")
		skill := c.skills[key]
		if skill == nil || !skill.Bool("enabled") || (e.String("ownership_type") == "user" && !c.allowed("skill", skill, user)) {
			issue("skill_disabled", true, "")
			continue
		}
		versions["skill:"+key] = []any{skill["revision"], skill["package_sha256"]}
	}
	for _, link := range c.links[id+":expert_connectors"] {
		key := link.String("connector_id")
		conn := c.connectors[key]
		if !c.allowed("connector", conn, user) {
			issue("missing_connector", link.Bool("required"), key)
			continue
		}
		state, ok := c.summaries[key]
		if !ok {
			var dto resource.Object
			if key == knowledgeBaseConnectorID {
				dto = r.knowledgeBaseConnectorDTO(conn)
			} else {
				var err error
				dto, err = r.mcp.ExpertSummary(ctx, q, conn, user)
				if err != nil {
					return nil, err
				}
			}
			state = connectorSummary{version: resource.Hash(dto), ready: connectorReady(dto)}
			c.summaries[key] = state
		}
		if !state.ready {
			issue("authorization_required", link.Bool("required"), key)
		}
		versions["connector:"+key] = []any{state.version, link["required"], link["tool_allowlist"], link["tool_denylist"]}
	}
	slices.SortFunc(issues, func(a, b resource.Object) int { return strings.Compare(resource.Hash(a), resource.Hash(b)) })
	versions["issues"] = issues
	out := resource.Object{"issues": issues, "available": available, "version": resource.Hash(versions)}
	if key := e.String("avatar_s3_key"); key != "" {
		out["avatar_path"] = "/api/v1/experts/" + id + "/avatar?v=" + resource.Hash(key)
	}
	return out, nil
}
