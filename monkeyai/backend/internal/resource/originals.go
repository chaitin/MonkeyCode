package resource

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// PutOriginal stores the immutable source and its UTF-8 filename in one request.
func (s *S3) PutOriginal(ctx context.Context, key string, data []byte, mime, name string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: &s.bucket, Key: &key, Body: bytes.NewReader(data), ContentType: &mime,
		Metadata: map[string]string{"filename-base64": base64.StdEncoding.EncodeToString([]byte(name))},
	})
	return err
}

func (s *S3) OriginalInfo(ctx context.Context, key string) (name, mime string, size int64, err error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return "", "", 0, err
	}
	decoded, decodeErr := base64.StdEncoding.DecodeString(out.Metadata["filename-base64"])
	if decodeErr == nil {
		name = string(decoded)
	}
	if name == "" {
		name = "original"
	}
	mime = aws.ToString(out.ContentType)
	if mime == "" {
		mime = "application/octet-stream"
	}
	return name, mime, aws.ToInt64(out.ContentLength), nil
}

// PresignGet uses the internal S3 endpoint reachable by the conversion service.
func (s *S3) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	out, err := s3.NewPresignClient(s.client).PresignGetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key}, func(o *s3.PresignOptions) { o.Expires = ttl })
	if err != nil {
		return "", err
	}
	return out.URL, nil
}

// WalkOriginals visits only expired import-source objects, never assets or documents.
func (s *S3) WalkOriginals(ctx context.Context, before time.Time, after *string, visit func(string) error) error {
	prefix := "knowledge/"
	input := &s3.ListObjectsV2Input{Bucket: &s.bucket, Prefix: &prefix}
	if *after != "" {
		input.StartAfter = aws.String(*after)
	}
	pages := s3.NewListObjectsV2Paginator(s.client, input)
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return err
		}
		for _, object := range page.Contents {
			key := aws.ToString(object.Key)
			parts := strings.Split(key, "/")
			if len(parts) != 5 || parts[0] != "knowledge" || parts[1] == "" || parts[2] != "imports" || parts[3] == "" || !strings.HasPrefix(parts[4], "original.") || object.LastModified == nil || !object.LastModified.Before(before) {
				*after = key
				continue
			}
			if err := visit(key); err != nil {
				return err
			}
			*after = key
		}
	}
	*after = ""
	return nil
}
