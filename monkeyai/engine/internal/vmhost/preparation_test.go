package vmhost

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
)

func TestPreparationReleaseRequiresNoDisksOrWriters(t *testing.T) {
	for _, mode := range []string{"empty", "disk-record", "disk-directory", "conversion", "download", "instance", "host-record", "committed"} {
		t.Run(mode, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			rate := firecracker.Rate{Bandwidth: firecracker.Bucket{Size: 1 << 20, RefillMS: 1000}, Operations: firecracker.Bucket{Size: 100, RefillMS: 1000}}
			d := &Driver{data: filepath.Join(root, "data"), state: filepath.Join(root, "state"), config: Config{LogicalLimit: 1 << 40, Policy: vmdisk.PressurePolicy{CriticalBytes: 1, WarningBytes: 2, RecoveryBytes: 3, CriticalInodes: 1, WarningInodes: 2, RecoveryInodes: 3}, GuestPool: "172.30.0.0/16", LinkPool: "172.29.0.0/16", DNS: []string{"1.1.1.1"}, NetworkRate: rate}}
			for _, path := range []string{d.data, d.state} {
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			spec := lifecycle.Spec{EnvironmentID: "prepare-1", NetworkPolicy: "isolated"}
			pool, err := d.pool()
			if err != nil {
				t.Fatal(err)
			}
			if err := pool.ReserveFiles(t.Context(), spec.EnvironmentID, 128<<20, 1<<20, 1); err != nil {
				t.Fatal(err)
			}
			key := storage.Key(spec.EnvironmentID)
			paths := map[string]string{
				"disk-record":    filepath.Join(d.data, "disks/records", key+".json"),
				"disk-directory": filepath.Join(d.data, "disks/disks", key),
				"conversion":     filepath.Join(d.data, "templates/templates/.convert-pending"),
				"download":       filepath.Join(d.data, "fetches/.prepare-pending"),
				"instance":       filepath.Join(d.state, "instances", key+".json"),
				"host-record":    filepath.Join(d.data, "host/records", key+".json"),
			}
			if path := paths[mode]; path != "" {
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("retain"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "committed" {
				if err := pool.Commit(spec.EnvironmentID); err != nil {
					t.Fatal(err)
				}
			}
			err = d.CleanupPreparation(t.Context(), spec)
			raw, readErr := os.ReadFile(filepath.Join(d.state, "capacity/reservations.json"))
			if readErr != nil {
				t.Fatal(readErr)
			}
			var reservations map[string]vmdisk.Reservation
			if json.Unmarshal(raw, &reservations) != nil {
				t.Fatal("容量记录损坏")
			}
			_, exists := reservations[spec.EnvironmentID]
			if mode == "empty" {
				if err != nil || exists {
					t.Fatal("已确认未创建磁盘却未释放准备预算", err)
				}
			} else {
				if err == nil || !exists {
					t.Fatal("不确定资源或持久盘预算被释放", mode, err)
				}
			}
			if path := paths[mode]; path != "" {
				data, err := os.ReadFile(path)
				if err != nil || string(data) != "retain" {
					t.Fatal("清理准备预算修改了已有对象", err)
				}
			}
		})
	}
}
