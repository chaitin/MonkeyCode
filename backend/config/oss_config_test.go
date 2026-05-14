package config

import "testing"

func TestObjectStorageDefaults(t *testing.T) {
	t.Setenv("MCAI_OBJECT_STORAGE_ENABLED", "")
	t.Setenv("MCAI_OBJECT_STORAGE_PROVIDER", "")
	t.Setenv("MCAI_OBJECT_STORAGE_FORCE_PATH_STYLE", "")
	t.Setenv("MCAI_OBJECT_STORAGE_PRESIGN_EXPIRES", "")
	t.Setenv("MCAI_OBJECT_STORAGE_MAX_SIZE", "")
	t.Setenv("MCAI_OBJECT_STORAGE_TEMP_PREFIX", "")
	t.Setenv("MCAI_TASKFLOW_GRPC_URL", "")

	cfg, err := Init(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ObjectStorage.Enabled {
		t.Fatal("object_storage.enabled default = true, want false")
	}
	if cfg.Server.BaseURL != "" {
		t.Fatalf("server.base_url = %q, want empty", cfg.Server.BaseURL)
	}
	if cfg.ObjectStorage.Provider != "s3" {
		t.Fatalf("provider = %q, want s3", cfg.ObjectStorage.Provider)
	}
	if !cfg.ObjectStorage.ForcePathStyle {
		t.Fatal("force_path_style default = false, want true")
	}
	if cfg.ObjectStorage.PresignExpires != "168h" {
		t.Fatalf("presign_expires = %q, want 168h", cfg.ObjectStorage.PresignExpires)
	}
	if cfg.ObjectStorage.AccessEndpoint != "" {
		t.Fatalf("access_endpoint = %q, want empty", cfg.ObjectStorage.AccessEndpoint)
	}
	if cfg.ObjectStorage.MaxSize != 50<<20 {
		t.Fatalf("max_size = %d, want %d", cfg.ObjectStorage.MaxSize, 50<<20)
	}
	if cfg.ObjectStorage.TempPrefix != "temp" {
		t.Fatalf("temp_prefix = %q", cfg.ObjectStorage.TempPrefix)
	}
	if cfg.TaskFlow.GrpcURL != "" {
		t.Fatalf("taskflow.grpc_url = %q, want empty", cfg.TaskFlow.GrpcURL)
	}
	if !cfg.StaticFiles.Enabled {
		t.Fatal("static_files.enabled default = false, want true")
	}
	if cfg.StaticFiles.Dir != "/app/static" {
		t.Fatalf("static_files.dir = %q", cfg.StaticFiles.Dir)
	}
	if cfg.StaticFiles.RoutePrefix != "/static" {
		t.Fatalf("static_files.route_prefix = %q", cfg.StaticFiles.RoutePrefix)
	}
	if cfg.HostInstaller.Mode != "online" {
		t.Fatalf("host_installer.mode = %q", cfg.HostInstaller.Mode)
	}
	if cfg.HostInstaller.BundlePath != "installer/{{.arch}}/host.tgz" {
		t.Fatalf("host_installer.bundle_path = %q", cfg.HostInstaller.BundlePath)
	}
}
