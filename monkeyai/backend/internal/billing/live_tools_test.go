package billing

import (
	"os"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestToolBillingWithoutToolRecord(t *testing.T) {
	for _, mode := range []string{"none", "centralized", "independent"} {
		t.Run(mode, func(t *testing.T) {
			s, user, _ := fixture(t)
			p := defaultPolicy()
			p.Enabled, p.RootCredits = true, amountText("10")
			setPolicy(t, s, p)
			connector, tool := resource.ID(), resource.ID()
			ledgerExec(t, s, `INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode,authorization_method)
				VALUES($1,$2,'实时工具','https://example.com',$3,CASE WHEN $3='none' THEN NULL ELSE 'http_header' END)`, connector, user, mode)
			if mode == "independent" {
				activityCutover(t, s)
			}
			req := Request{UserID: user, ResourceID: tool, ConnectorID: connector, ToolName: "remote_tool", Category: "tool"}
			reservation, err := s.Begin(t.Context(), req)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.Start(t.Context(), reservation.ID); err != nil {
				t.Fatal(err)
			}
			if err := s.Finish(t.Context(), reservation.ID, Usage{Known: true, Result: "succeeded"}); err != nil {
				t.Fatal(err)
			}
			var name, amount string
			if err := s.pool.QueryRow(t.Context(), "SELECT item_name,raw_amount::text FROM billing_transactions WHERE id=$1", reservation.ID).Scan(&name, &amount); err != nil || name != "remote_tool" || amountText(amount) != 0 {
				t.Fatalf("未保留免费工具调用名称或误扣积分: %s %s %v", name, amount, err)
			}
			var count int
			if err := s.pool.QueryRow(t.Context(), "SELECT count(*) FROM mcp_tool_calls WHERE id=$1 AND tool_id=$2 AND connector_id=$3", reservation.ID, tool, connector).Scan(&count); err != nil || count != 1 {
				t.Fatalf("未保存无工具配置的调用记录: %d %v", count, err)
			}
			if err := s.pool.QueryRow(t.Context(), "SELECT count(*) FROM mcp_tools WHERE connector_id=$1", connector).Scan(&count); err != nil || count != 0 {
				t.Fatalf("计费不应创建工具目录记录: %d %v", count, err)
			}
			for _, direction := range []string{"down", "up"} {
				sql, err := os.ReadFile("../../migrations/000042_mcp_live_tools." + direction + ".sql")
				if err != nil {
					t.Fatal(err)
				}
				ledgerExec(t, s, string(sql))
			}
			if err := s.pool.QueryRow(t.Context(), "SELECT count(*) FROM mcp_tool_calls WHERE id=$1", reservation.ID).Scan(&count); err != nil || count != 1 {
				t.Fatalf("迁移回滚／升级不应改写历史调用: %d %v", count, err)
			}
		})
	}
}

func TestToolBillingHonorsSetting(t *testing.T) {
	s, user, _ := fixture(t)
	p := defaultPolicy()
	p.Enabled, p.RootCredits = true, amountText("10")
	setPolicy(t, s, p)
	connector, tool := resource.ID(), resource.ID()
	ledgerExec(t, s, "INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode,authorization_method) VALUES($1,$2,'集中工具','https://example.com','centralized','http_header')", connector, user)
	ledgerExec(t, s, "INSERT INTO mcp_tools(id,connector_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,'paid',false,2.5,1)", tool, connector)
	req := Request{UserID: user, ResourceID: resource.ID(), ConnectorID: connector, ToolName: "paid", Category: "tool"}
	if _, err := s.Begin(t.Context(), req); err == nil {
		t.Fatal("已禁用的配置不应回退到默认开启")
	}
	ledgerExec(t, s, "UPDATE mcp_tools SET enabled=true WHERE id=$1", tool)
	reservation, err := s.Begin(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Start(t.Context(), reservation.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(t.Context(), reservation.ID, Usage{Known: true, Result: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	var amount string
	if err := s.pool.QueryRow(t.Context(), "SELECT raw_amount::text FROM billing_transactions WHERE id=$1", reservation.ID).Scan(&amount); err != nil || amountText(amount) != amountText("2.5") {
		t.Fatalf("集中认证工具单价未生效: %s %v", amount, err)
	}
}
