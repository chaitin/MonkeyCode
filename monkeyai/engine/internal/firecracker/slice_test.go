package firecracker

import (
	"slices"
	"strings"
	"testing"
)

func TestVMSliceOwnership(t *testing.T) {
	id := strings.Repeat("a", 64)
	other := strings.Repeat("b", 64)
	args := systemFixture(t).launchCommand(Launch{ID: id, VCPUs: 1}, NetworkLease{})
	if !slices.Contains(args, "--slice=monkeyai-vm.slice") {
		t.Fatal(args)
	}
	for _, parent := range []string{"/monkeyai.slice/monkeyai-vm.slice/", "/system.slice/"} {
		group := parent + Unit(id)
		if !ownsGroup(id, group) || ownsGroup(other, group) || ownsGroup(id, group+"/child") {
			t.Fatal(group)
		}
	}
}
