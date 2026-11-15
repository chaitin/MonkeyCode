package preflight

import (
	"net"
	"testing"
)

func TestHostInterfaces(t *testing.T) {
	for _, test := range []struct {
		name  string
		flags net.Flags
		want  bool
	}{
		{"eth0", net.FlagUp, true}, {"ens5", net.FlagUp, true},
		{"eth0", 0, false}, {"lo", net.FlagUp | net.FlagLoopback, false},
		{"docker0", net.FlagUp, false}, {"br-1234", net.FlagUp, false}, {"veth123", net.FlagUp, false},
	} {
		if hostInterface(net.Interface{Name: test.name, Flags: test.flags}) != test.want {
			t.Fatal(test)
		}
	}
}
