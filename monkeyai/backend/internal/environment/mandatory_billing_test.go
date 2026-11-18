package environment

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
)

func TestCloudCreationIgnoresLegacyBillingSwitches(t *testing.T) {
	for _, tc := range []struct {
		name, cpu, want string
		entries         int
	}{{"有价", "123", "123", 1}, {"零价", "0", "0", 0}} {
		t.Run(tc.name, func(t *testing.T) {
			s, user, _ := fixture(t)
			credits := billing.NewService(s.pool)
			if err := credits.Initialize(t.Context()); err != nil {
				t.Fatal(err)
			}
			s.WithBilling(credits)
			_, err := s.pool.Exec(t.Context(), `UPDATE settings SET value=value || jsonb_build_object('enabled',false,'environment',jsonb_build_object('enabled',false,'cpu_credits_per_core_hour',$1::text,'memory_credits_per_gib_hour','0')) WHERE key='billing'`, tc.cpu)
			if err != nil {
				t.Fatal(err)
			}
			created, err := s.Create(t.Context(), user, Creation{testSpecification(), "预付验证", "mandatory-billing"})
			if err != nil {
				t.Fatal(err)
			}
			cost(t, s, user, tc.want, tc.entries)
			views := []View{created.Environment}
			if err := s.billingViews(t.Context(), views); err != nil {
				t.Fatal(err)
			}
			v := views[0].Billing
			if v == nil || (v.State == "free") != (tc.entries == 0) || v.HourlyCredits.String() != tc.want {
				t.Fatalf("计费展示与定价不符：%+v", v)
			}
		})
	}
}
