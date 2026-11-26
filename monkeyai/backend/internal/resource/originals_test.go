package resource

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func TestOriginalMetadataAndPresign(t *testing.T) {
	name := "合同 中文.pdf"
	var stored []byte
	var filename, contentType string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bucket/knowledge/original.pdf" {
			t.Errorf("unexpected key %s", r.URL.Path)
		}
		switch r.Method {
		case "PUT":
			stored, _ = io.ReadAll(r.Body)
			filename = r.Header.Get("X-Amz-Meta-Filename-Base64")
			contentType = r.Header.Get("Content-Type")
		case "HEAD":
			w.Header().Set("X-Amz-Meta-Filename-Base64", filename)
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("Content-Length", "8")
		case "GET":
			if r.URL.Query().Get("X-Amz-Signature") == "" {
				t.Error("missing signature")
			}
			w.Write(stored)
		}
	}))
	defer server.Close()
	client := s3.New(s3.Options{BaseEndpoint: &server.URL, Region: "us-east-1", UsePathStyle: true, Credentials: credentials.NewStaticCredentialsProvider("access", "secret", ""), RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired})
	storage := &S3{client: client, bucket: "bucket"}
	ctx := context.Background()
	if err := storage.PutOriginal(ctx, "knowledge/original.pdf", []byte("%PDF-1.7"), "application/pdf", name); err != nil {
		t.Fatal(err)
	}
	if filename != base64.StdEncoding.EncodeToString([]byte(name)) {
		t.Fatal("filename metadata lost")
	}
	gotName, mime, size, err := storage.OriginalInfo(ctx, "knowledge/original.pdf")
	if err != nil || gotName != name || mime != "application/pdf" || size != 8 {
		t.Fatalf("metadata: %q %q %d %v", gotName, mime, size, err)
	}
	url, err := storage.PresignGet(ctx, "knowledge/original.pdf", 10*time.Minute)
	if err != nil || !strings.Contains(url, "X-Amz-Expires=600") {
		t.Fatalf("presign: %v", err)
	}
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	if string(data) != "%PDF-1.7" {
		t.Fatal("original bytes changed")
	}
}

func TestWalkOriginalsResumesAtInterruptedObject(t *testing.T) {
	const first = "knowledge/book/imports/a/original.txt"
	const second = "knowledge/book/imports/b/original.txt"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		fmt.Fprint(w, "<ListBucketResult>")
		keys := []string{second}
		switch after := r.URL.Query().Get("start-after"); after {
		case "":
			keys = []string{first, second}
		case first:
		default:
			t.Errorf("unexpected cursor %q", after)
		}
		for _, key := range keys {
			fmt.Fprintf(w, "<Contents><Key>%s</Key><LastModified>2020-01-01T00:00:00Z</LastModified></Contents>", key)
		}
		fmt.Fprint(w, "</ListBucketResult>")
	}))
	defer server.Close()
	storage := &S3{bucket: "bucket", client: s3.New(s3.Options{BaseEndpoint: &server.URL, Region: "us-east-1", UsePathStyle: true, Credentials: credentials.NewStaticCredentialsProvider("access", "secret", "")})}
	var after string
	err := storage.WalkOriginals(t.Context(), time.Now(), &after, func(key string) error {
		if key == second {
			return context.DeadlineExceeded
		}
		return nil
	})
	if !errors.Is(err, context.DeadlineExceeded) || after != first {
		t.Fatalf("cursor %q, err %v", after, err)
	}
	var visited []string
	err = storage.WalkOriginals(t.Context(), time.Now(), &after, func(key string) error { visited = append(visited, key); return nil })
	if err != nil || after != "" || len(visited) != 1 || visited[0] != second {
		t.Fatalf("cursor %q, visited %v, err %v", after, visited, err)
	}
}
