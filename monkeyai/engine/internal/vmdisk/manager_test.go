package vmdisk

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func diskFixture(t *testing.T) (*Manager, Spec, string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	format := func(ctx context.Context, path string, size int64) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			return err
		}
		return errors.Join(f.Truncate(size), f.Close())
	}
	m, err := New(filepath.Join(root, "store"), format)
	if err != nil {
		t.Fatal(err)
	}
	spec := Spec{EnvironmentID: "env-1", InstanceID: "instance-1", TemplateID: "template-1", SystemBytes: 64 << 20, DataBytes: 64 << 20}
	template := filepath.Join(root, "template.raw")
	if err := format(context.Background(), template, spec.SystemBytes); err != nil {
		t.Fatal(err)
	}
	return m, spec, template
}

func TestManagerLifecycle(t *testing.T) {
	ctx := context.Background()
	m, spec, template := diskFixture(t)
	disks, err := m.Ensure(ctx, spec, template)
	if err != nil {
		t.Fatal(err)
	}
	if disks.State != "ready" {
		t.Fatalf("state = %q", disks.State)
	}
	f, err := os.OpenFile(disks.Data, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.WriteAt([]byte("user data"), 4096)
	if closeErr := f.Close(); err != nil || closeErr != nil {
		t.Fatal(errors.Join(err, closeErr))
	}
	again, err := m.Ensure(ctx, spec, template)
	if err != nil || again != disks {
		t.Fatalf("replay = %+v, %v", again, err)
	}
	leased, err := m.Acquire(spec.EnvironmentID, spec.InstanceID)
	if err != nil {
		t.Fatal(err)
	}
	if leased.Lease == "" {
		t.Fatal("missing durable lease")
	}
	if _, err := m.Acquire(spec.EnvironmentID, spec.InstanceID); err == nil {
		t.Fatal("acquired twice")
	}
	if err := m.Retain(spec.EnvironmentID, spec.InstanceID); err == nil {
		t.Fatal("retained an active disk")
	}
	m2, err := New(m.root, m.format)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m2.Acquire(spec.EnvironmentID, spec.InstanceID); err == nil {
		t.Fatal("restart lost lease")
	}
	if err := m2.Release(ctx, spec.EnvironmentID, spec.InstanceID, leased.Lease, func(context.Context) (bool, error) { return false, nil }); err == nil {
		t.Fatal("released a running VM")
	}
	if err := m2.Release(ctx, spec.EnvironmentID, spec.InstanceID, "wrong", func(context.Context) (bool, error) { return true, nil }); err == nil {
		t.Fatal("released wrong lease")
	}
	if err := m2.Release(ctx, spec.EnvironmentID, spec.InstanceID, leased.Lease, func(context.Context) (bool, error) { return true, nil }); err != nil {
		t.Fatal(err)
	}
	if err := m2.Retain(spec.EnvironmentID, spec.InstanceID); err != nil {
		t.Fatal(err)
	}
	if _, err := m2.Ensure(ctx, spec, template); err == nil {
		t.Fatal("reused retained disks")
	}
	if err := m2.Destroy(spec.EnvironmentID, spec.InstanceID, false); err == nil {
		t.Fatal("destroyed without confirmation")
	}
	if _, err := os.Stat(disks.Data); err != nil {
		t.Fatal("retention lost data:", err)
	}
	if err := m2.Destroy(spec.EnvironmentID, spec.InstanceID, true); err != nil {
		t.Fatal(err)
	}
	if err := m2.Destroy(spec.EnvironmentID, spec.InstanceID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(disks.Data); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("disk still exists: %v", err)
	}
	if _, err := m2.Ensure(ctx, spec, template); err == nil {
		t.Fatal("recreated destroyed environment")
	}
}

func TestManagerRefusesMissingOrChangedDisk(t *testing.T) {
	for _, change := range []string{"missing-directory", "missing-disk", "truncated", "spec", "symlink"} {
		t.Run(change, func(t *testing.T) {
			m, spec, template := diskFixture(t)
			disks, err := m.Ensure(context.Background(), spec, template)
			if err != nil {
				t.Fatal(err)
			}
			switch change {
			case "missing-directory":
				err = os.RemoveAll(filepath.Dir(disks.System))
			case "missing-disk":
				err = os.Remove(disks.Data)
			case "truncated":
				err = os.Truncate(disks.Data, 4096)
			case "spec":
				spec.DataBytes *= 2
			case "symlink":
				err = os.Remove(disks.System)
				if err == nil {
					err = os.Symlink(template, disks.System)
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := m.Ensure(context.Background(), spec, template); err == nil {
				t.Fatal("accepted damaged or changed disk")
			}
		})
	}
}

func TestManagerPreparationFailureFailsClosed(t *testing.T) {
	m, spec, template := diskFixture(t)
	m.format = func(context.Context, string, int64) error { return errors.New("format failed") }
	if _, err := m.Ensure(context.Background(), spec, template); err == nil {
		t.Fatal("accepted failed formatting")
	}
	got, err := m.Load(spec.EnvironmentID)
	if err != nil || got.State != "preparing" {
		t.Fatalf("record = %+v, %v", got, err)
	}
	if _, err := m.Ensure(context.Background(), spec, template); err == nil {
		t.Fatal("silently retried incomplete preparation")
	}
	if _, err := m.Acquire(spec.EnvironmentID, spec.InstanceID); err == nil {
		t.Fatal("acquired incomplete disks")
	}
}

func TestManagerOwnershipAndCancellation(t *testing.T) {
	m, spec, template := diskFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := m.Ensure(ctx, spec, template); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel = %v", err)
	}
	if _, err := m.Ensure(context.Background(), spec, template); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Acquire(spec.EnvironmentID, "different-instance"); err == nil {
		t.Fatal("accepted wrong owner")
	}
	if err := m.Retain(spec.EnvironmentID, "different-instance"); err == nil {
		t.Fatal("retained wrong owner")
	}
	if err := m.Destroy(spec.EnvironmentID, "different-instance", true); err == nil {
		t.Fatal("destroyed wrong owner")
	}
}
