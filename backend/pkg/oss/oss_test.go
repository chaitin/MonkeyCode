package oss

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestObjectKeyJoinsPrefixAndFilename(t *testing.T) {
	key := objectKey("/tmp/task-attachments/", "/a.txt")
	if key != "tmp/task-attachments/a.txt" {
		t.Fatalf("key = %q", key)
	}
}

func TestObjectKeyKeepsFilenameInsidePrefix(t *testing.T) {
	key := objectKey("tmp/task-attachments", "../a #?.txt")
	if key != "tmp/task-attachments/a #?.txt" {
		t.Fatalf("key = %q", key)
	}
}

func TestNormalizeExpires(t *testing.T) {
	if got := normalizeExpires(0); got != 10*time.Minute {
		t.Fatalf("zero expires = %s", got)
	}
	if got := normalizeExpires(8 * 24 * time.Hour); got != 7*24*time.Hour {
		t.Fatalf("large expires = %s", got)
	}
}

func TestPublicURLUsesAccessEndpoint(t *testing.T) {
	client := &Client{
		cfg: config.ObjectStorageConfig{
			AccessEndpoint: "http://localhost:9000/monkeycode-private",
		},
	}
	url := client.GetURL("tmp/task-attachments", "a.txt")
	if url != "http://localhost:9000/monkeycode-private/tmp/task-attachments/a.txt" {
		t.Fatalf("url = %q", url)
	}
}

func TestPublicURLAddsBucketWhenAccessEndpointHasNoPath(t *testing.T) {
	client := &Client{
		cfg: config.ObjectStorageConfig{
			AccessEndpoint: "http://localhost:9000",
			Bucket:         "monkeycode-private",
		},
	}
	url := client.GetURL("tmp/task-attachments", "a.txt")
	if url != "http://localhost:9000/monkeycode-private/tmp/task-attachments/a.txt" {
		t.Fatalf("url = %q", url)
	}
}

func TestPublicURLEscapesPath(t *testing.T) {
	client := &Client{
		cfg: config.ObjectStorageConfig{
			AccessEndpoint: "http://localhost:9000/monkeycode-private",
		},
	}
	url := client.GetURL("tmp", "a #?.txt")
	if url != "http://localhost:9000/monkeycode-private/tmp/a%20%23%3F.txt" {
		t.Fatalf("url = %q", url)
	}
}

func TestValidateConfigRequiresS3Fields(t *testing.T) {
	err := validateConfig(config.ObjectStorageConfig{})
	if err == nil {
		t.Fatal("expected config error")
	}
}

func TestHeadFileReturnsTrueWhenObjectExists(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodHead {
			t.Fatalf("method = %s, want HEAD", r.Method)
		}
		if r.URL.Path != "/bucket/repo/project-tpl.zip" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        server.URL,
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "bucket",
	}, S3Option{ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	exists, err := client.HeadFile(context.Background(), "repo", "project-tpl.zip")
	if err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatal("exists = false, want true")
	}
}

func TestHeadFileReturnsFalseWhenObjectMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>`))
	}))
	defer server.Close()

	client, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        server.URL,
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "bucket",
	}, S3Option{ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	exists, err := client.HeadFile(context.Background(), "repo", "project-tpl.zip")
	if err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("exists = true, want false")
	}
}

func TestPresignUsesAccessEndpointHost(t *testing.T) {
	client, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        "http://internal:9000",
		AccessEndpoint:  "http://public.example.com/monkeycode-private",
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "monkeycode-private",
	}, S3Option{ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	presign, err := client.Presign(context.Background(), "tmp", "a.txt", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(presign.UploadURL, "internal:9000") || strings.Contains(presign.AccessURL, "internal:9000") {
		t.Fatalf("presign url uses internal endpoint: %#v", presign)
	}
	if !strings.Contains(presign.UploadURL, "public.example.com") || !strings.Contains(presign.AccessURL, "public.example.com") {
		t.Fatalf("presign url does not use access endpoint: %#v", presign)
	}
}

func TestPresignWithAccessEndpointOverridesConfiguredEndpoint(t *testing.T) {
	client, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        "http://internal:9000",
		AccessEndpoint:  "http://old.example.com/monkeycode-private",
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "monkeycode-private",
	}, S3Option{ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	presign, err := client.WithAccessEndpoint("https://new.example.com").Presign(context.Background(), "tmp", "a.txt", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(presign.UploadURL, "new.example.com") || !strings.Contains(presign.AccessURL, "new.example.com") {
		t.Fatalf("presign url does not use request access endpoint: %#v", presign)
	}
	if strings.Contains(presign.UploadURL, "old.example.com") || strings.Contains(presign.AccessURL, "old.example.com") {
		t.Fatalf("presign url uses configured endpoint: %#v", presign)
	}
}

func TestPresignWithAccessEndpointKeepsPathPrefixOutsideSignature(t *testing.T) {
	client, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        "http://internal:9000",
		AccessEndpoint:  "https://monkeycode.example.com/oss",
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "monkeycode-private",
	}, S3Option{ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	presign, err := client.Presign(context.Background(), "tmp", "a.txt", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(presign.UploadURL, "/oss/monkeycode-private/tmp/a.txt") {
		t.Fatalf("presign upload url path missing /oss prefix: %s", presign.UploadURL)
	}
	if !strings.Contains(presign.AccessURL, "/oss/monkeycode-private/tmp/a.txt") {
		t.Fatalf("presign access url path missing /oss prefix: %s", presign.AccessURL)
	}
	signingClient, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        "http://internal:9000",
		AccessEndpoint:  "https://monkeycode.example.com",
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "monkeycode-private",
	}, S3Option{ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	signingPresign, err := signingClient.Presign(context.Background(), "tmp", "a.txt", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if signatureValue(t, presign.UploadURL) != signatureValue(t, signingPresign.UploadURL) {
		t.Fatalf("presign upload signature includes proxy prefix: %s", presign.UploadURL)
	}
}

func signatureValue(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("X-Amz-Signature")
}

func TestGetURLWithAccessEndpointOverridesConfiguredEndpoint(t *testing.T) {
	client := &Client{
		cfg: config.ObjectStorageConfig{
			AccessEndpoint: "http://old.example.com/monkeycode-private",
			Bucket:         "monkeycode-private",
		},
	}
	got := client.WithAccessEndpoint("https://new.example.com").GetURL("tmp", "a.txt")
	if got != "https://new.example.com/monkeycode-private/tmp/a.txt" {
		t.Fatalf("url = %q", got)
	}
}

func TestInitBucketReturnsBucketAlreadyExists(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`<Error><Code>BucketAlreadyExists</Code><Message>exists</Message></Error>`))
	}))
	defer server.Close()

	_, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        server.URL,
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "bucket",
	}, S3Option{ForcePathStyle: true, InitBucket: true})
	if err == nil {
		t.Fatal("expected bucket already exists error")
	}
}

func TestInitBucketSetsLocationConstraintForRegion(t *testing.T) {
	var body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		body = string(data)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	_, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        server.URL,
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "bucket",
		Region:          "eu-west-1",
	}, S3Option{ForcePathStyle: true, InitBucket: true})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "eu-west-1") {
		t.Fatalf("create bucket body = %q", body)
	}
}

func TestInitBucketSetsPublicReadPolicyForPermanentPrefixes(t *testing.T) {
	var policy string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery == "policy=" || r.URL.RawQuery == "policy" {
			data, _ := io.ReadAll(r.Body)
			policy = string(data)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	_, err := NewS3Compatible(context.Background(), config.ObjectStorageConfig{
		Endpoint:        server.URL,
		AccessKey:       "ak",
		AccessKeySecret: "sk",
		Bucket:          "bucket",
		AvatarPrefix:    "avatar",
		SpecPrefix:      "spec",
		RepoPrefix:      "repo",
		TempPrefix:      "temp",
	}, S3Option{ForcePathStyle: true, InitBucket: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"Principal":{"AWS":["*"]}`,
		`"arn:aws:s3:::bucket/avatar/*"`,
		`"arn:aws:s3:::bucket/spec/*"`,
		`"arn:aws:s3:::bucket/repo/*"`,
	} {
		if !strings.Contains(policy, want) {
			t.Fatalf("policy missing %s: %s", want, policy)
		}
	}
	if strings.Contains(policy, "temp") {
		t.Fatalf("policy exposes temp prefix: %s", policy)
	}
}

func TestPublicReadResourcesSkipsEmptyAndDuplicatePrefixes(t *testing.T) {
	got := publicReadResources(config.ObjectStorageConfig{
		Bucket:       "bucket",
		AvatarPrefix: "avatar",
		SpecPrefix:   "/avatar/",
		RepoPrefix:   "",
		TempPrefix:   "temp",
	})
	if len(got) != 1 {
		t.Fatalf("resources = %#v", got)
	}
	if got[0] != "arn:aws:s3:::bucket/avatar/*" {
		t.Fatalf("resource = %q", got[0])
	}
}
