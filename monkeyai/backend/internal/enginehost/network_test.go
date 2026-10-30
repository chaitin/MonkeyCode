package enginehost

import "testing"

func TestNetworkPoliciesAllowLegacyAndKnownCapabilities(t *testing.T) {
	for _, p := range [][]string{nil, {}, {"isolated"}, {"public-only"}, {"isolated", "public-only"}} {
		if !validNetworkPolicies(p) {
			t.Fatal(p)
		}
	}
	for _, p := range [][]string{{"host"}, {"isolated", "isolated"}, {"public-only", "host"}, {"isolated", "public-only", "host"}} {
		if validNetworkPolicies(p) {
			t.Fatal(p)
		}
	}
}
