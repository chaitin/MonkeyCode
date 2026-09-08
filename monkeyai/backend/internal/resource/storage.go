package resource

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type Storage interface {
	Put(context.Context, string, []byte, string) error
	Get(context.Context, string) (io.ReadCloser, error)
	Delete(context.Context, string) error
	Ping(context.Context) error
}
type S3 struct {
	client   *s3.Client
	bucket   string
	mu       sync.Mutex
	checked  time.Time
	checkErr error
}

func NewS3(ctx context.Context) (*S3, error) {
	endpoint := os.Getenv("MONKEYAI_S3_ENDPOINT")
	bucket := os.Getenv("MONKEYAI_S3_BUCKET")
	if bucket == "" {
		bucket = "monkeyai-resources"
	}
	region := os.Getenv("MONKEYAI_S3_REGION")
	if region == "" {
		region = "us-east-1"
	}
	if endpoint == "" {
		return nil, errors.New("MONKEYAI_S3_ENDPOINT 不能为空")
	}
	if os.Getenv("MONKEYAI_S3_ACCESS_KEY") == "" || os.Getenv("MONKEYAI_S3_SECRET_KEY") == "" {
		return nil, errors.New("对象存储凭据不能为空")
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region), awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(os.Getenv("MONKEYAI_S3_ACCESS_KEY"), os.Getenv("MONKEYAI_S3_SECRET_KEY"), "")))
	if err != nil {
		return nil, err
	}
	return &S3{client: s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = os.Getenv("MONKEYAI_S3_FORCE_PATH_STYLE") != "false"
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
		o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
	}), bucket: bucket}, nil
}
func (s *S3) Init(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &s.bucket})
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*types.NotFound](err); !ok {
		return err
	}
	_, err = s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &s.bucket})
	return err
}
func (s *S3) Put(ctx context.Context, key string, b []byte, mime string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{Bucket: &s.bucket, Key: &key, Body: bytes.NewReader(b), ContentType: &mime})
	return err
}
func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	o, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return nil, err
	}
	return o.Body, nil
}
func (s *S3) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.bucket, Key: &key})
	return err
}
func (s *S3) Ping(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.checked) < 5*time.Second {
		return s.checkErr
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, s.checkErr = s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &s.bucket})
	s.checked = time.Now()
	return s.checkErr
}
