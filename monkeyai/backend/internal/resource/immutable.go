package resource

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
)

func (s *S3) PutImmutable(ctx context.Context, key string, body io.ReadSeeker, size int64, mime, sha string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.bucket, Key: &key, Body: body, ContentLength: &size, ContentType: &mime, IfNoneMatch: aws.String("*"), Metadata: map[string]string{"sha256": sha}})
	if err == nil {
		return nil
	}
	var api smithy.APIError
	if !errors.As(err, &api) || (api.ErrorCode() != "PreconditionFailed" && api.ErrorCode() != "ConditionalRequestConflict") {
		return err
	}
	head, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return err
	}
	if aws.ToInt64(head.ContentLength) != size || head.Metadata["sha256"] != sha {
		return errors.New("内容地址对象已存在且摘要或大小不符")
	}
	return nil
}
func (s *S3) HeadImmutable(ctx context.Context, key string) (int64, string, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return 0, "", err
	}
	return aws.ToInt64(out.ContentLength), out.Metadata["sha256"], nil
}

func (s *S3) GetRange(ctx context.Context, key string, start, end int64) (io.ReadCloser, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key, Range: aws.String(fmt.Sprintf("bytes=%d-%d", start, end))})
	if err != nil {
		return nil, err
	}
	return out.Body, nil
}
