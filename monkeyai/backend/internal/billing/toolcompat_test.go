package billing

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestLegacyIndependentToolBilling(t *testing.T) {
	s, user, _ := fixture(t)
	p := defaultPolicy()
	p.Enabled, p.RootCredits = true, amountText("10")
	setPolicy(t, s, p)
	connector, tool := resource.ID(), resource.ID()
	ledgerExec(t, s, "INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode,authorization_method) VALUES($1,$2,'历史独立认证','https://example.com','independent','http_header')", connector, user)
	credentials := []string{resource.ID(), resource.ID()}
	for _, id := range credentials {
		ledgerExec(t, s, "INSERT INTO connector_credentials(id,connector_id,user_id,http_headers,config_revision) VALUES($1,$2,$3,'{\"X-Account\":\"A\"}',1)", id, connector, user)
	}
	ledgerExec(t, s, "INSERT INTO mcp_tools(id,connector_id,credential_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,$3,'legacy',false,2.5,1)", tool, connector, credentials[0])
	req := Request{UserID: user, ResourceID: tool, ConnectorID: connector, CredentialID: credentials[0], ToolName: "legacy", Category: "tool"}
	if _, err := s.Begin(t.Context(), req); err == nil {
		t.Fatal("独立认证的历史禁用配置不应被计费入口忽略")
	}
	for _, credential := range credentials {
		if credential == credentials[0] {
			ledgerExec(t, s, "UPDATE mcp_tools SET enabled=true WHERE id=$1", tool)
		}
		req.CredentialID = credential
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
		if err := s.pool.QueryRow(t.Context(), "SELECT raw_amount::text FROM billing_transactions WHERE id=$1", reservation.ID).Scan(&amount); err != nil || amountText(amount) != 0 {
			t.Fatalf("独立认证不应收取历史单价或混用其他凭证配置: %s %v", amount, err)
		}
	}
}
