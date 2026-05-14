package oss

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/chaitin/MonkeyCode/backend/config"
)

const (
	defaultExpires = 10 * time.Minute
	maxExpires     = 7 * 24 * time.Hour
)

type S3Option struct {
	ForcePathStyle bool
	InitBucket     bool
}

type Client struct {
	cfg       config.ObjectStorageConfig
	region    string
	s3        *s3.Client
	presigner *s3.PresignClient
	pathStyle bool
}

type Presign struct {
	UploadURL string
	AccessURL string
}

func NewS3Compatible(ctx context.Context, cfg config.ObjectStorageConfig, opt S3Option) (*Client, error) {
	if err := validateConfig(cfg); err != nil {
		return nil, err
	}
	region := normalizeRegion(cfg.Region)
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.AccessKeySecret, "")),
	)
	if err != nil {
		return nil, err
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.Endpoint)
		o.UsePathStyle = opt.ForcePathStyle
	})
	c := &Client{
		cfg:       cfg,
		region:    region,
		s3:        client,
		pathStyle: opt.ForcePathStyle,
		presigner: s3.NewPresignClient(client, s3.WithPresignClientFromClientOptions(func(o *s3.Options) {
			o.BaseEndpoint = aws.String(presignSigningEndpoint(cfg))
			o.UsePathStyle = opt.ForcePathStyle
		})),
	}
	if opt.InitBucket {
		if err := c.initBucket(ctx); err != nil {
			return nil, err
		}
	}
	return c, nil
}

func validateConfig(cfg config.ObjectStorageConfig) error {
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return errors.New("oss endpoint is empty")
	}
	if strings.TrimSpace(cfg.AccessKey) == "" {
		return errors.New("oss access key is empty")
	}
	if strings.TrimSpace(cfg.AccessKeySecret) == "" {
		return errors.New("oss access key secret is empty")
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return errors.New("oss bucket is empty")
	}
	return nil
}

func (c *Client) initBucket(ctx context.Context) error {
	input := &s3.CreateBucketInput{
		Bucket: aws.String(c.cfg.Bucket),
	}
	if c.region != "" && c.region != "us-east-1" {
		input.CreateBucketConfiguration = &s3types.CreateBucketConfiguration{
			LocationConstraint: s3types.BucketLocationConstraint(c.region),
		}
	}
	_, err := c.s3.CreateBucket(ctx, input)
	if err != nil {
		var bucketOwned *s3types.BucketAlreadyOwnedByYou
		if !errors.As(err, &bucketOwned) {
			return err
		}
	}
	return c.initPublicReadPolicy(ctx)
}

func (c *Client) initPublicReadPolicy(ctx context.Context) error {
	resources := publicReadResources(c.cfg)
	if len(resources) == 0 {
		return nil
	}
	policy := bucketPolicy{
		Version: "2012-10-17",
		Statement: []bucketPolicyStatement{
			{
				Effect:    "Allow",
				Principal: bucketPolicyPrincipal{AWS: []string{"*"}},
				Action:    []string{"s3:GetObject"},
				Resource:  resources,
			},
		},
	}
	data, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	_, err = c.s3.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
		Bucket: aws.String(c.cfg.Bucket),
		Policy: aws.String(string(data)),
	})
	return err
}

func (c *Client) PutFile(ctx context.Context, prefix, filename string, r io.Reader) error {
	_, err := c.s3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.cfg.Bucket),
		Key:    aws.String(objectKey(prefix, filename)),
		Body:   r,
	})
	return err
}

func (c *Client) HeadFile(ctx context.Context, prefix, filename string) (bool, error) {
	_, err := c.s3.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(c.cfg.Bucket),
		Key:    aws.String(objectKey(prefix, filename)),
	})
	if err == nil {
		return true, nil
	}
	var notFound *s3types.NotFound
	if errors.As(err, &notFound) {
		return false, nil
	}
	return false, err
}

func (c *Client) WithAccessEndpoint(endpoint string) *Client {
	endpoint = strings.TrimSpace(endpoint)
	if c == nil || endpoint == "" {
		return c
	}
	next := *c
	next.cfg.AccessEndpoint = endpoint
	if c.s3 != nil {
		next.presigner = s3.NewPresignClient(c.s3, s3.WithPresignClientFromClientOptions(func(o *s3.Options) {
			o.BaseEndpoint = aws.String(presignSigningEndpoint(next.cfg))
			o.UsePathStyle = c.pathStyle
		}))
	}
	return &next
}

func (c *Client) GetURL(prefix, filename string) string {
	base := objectAccessBase(c.cfg)
	return appendURLPath(base, objectKey(prefix, filename))
}

func (c *Client) Presign(ctx context.Context, prefix, filename string, expires time.Duration) (*Presign, error) {
	expires = normalizeExpires(expires)
	key := objectKey(prefix, filename)
	putURL, err := c.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.cfg.Bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return nil, fmt.Errorf("presign put object: %w", err)
	}
	getURL, err := c.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.cfg.Bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(expires))
	if err != nil {
		return nil, fmt.Errorf("presign get object: %w", err)
	}
	return &Presign{
		UploadURL: c.publicPresignURL(putURL.URL, key),
		AccessURL: c.publicPresignURL(getURL.URL, key),
	}, nil
}

func objectKey(prefix, filename string) string {
	cleanPrefix := cleanObjectPrefix(prefix)
	name := path.Base(strings.Trim(filename, "/"))
	if name == "." || name == ".." || name == "/" {
		name = ""
	}
	return strings.Trim(path.Join(cleanPrefix, name), "/")
}

func normalizeExpires(expires time.Duration) time.Duration {
	if expires <= 0 {
		return defaultExpires
	}
	if expires > maxExpires {
		return maxExpires
	}
	return expires
}

func normalizeRegion(region string) string {
	region = strings.TrimSpace(region)
	if region == "" {
		return "us-east-1"
	}
	return region
}

func cleanObjectPrefix(prefix string) string {
	cleanPrefix := strings.Trim(path.Clean(strings.Trim(prefix, "/")), "/")
	for cleanPrefix == ".." || strings.HasPrefix(cleanPrefix, "../") {
		cleanPrefix = strings.TrimPrefix(cleanPrefix, "../")
		if cleanPrefix == ".." {
			return ""
		}
	}
	if cleanPrefix == "." {
		return ""
	}
	return cleanPrefix
}

type bucketPolicy struct {
	Version   string                  `json:"Version"`
	Statement []bucketPolicyStatement `json:"Statement"`
}

type bucketPolicyStatement struct {
	Effect    string                `json:"Effect"`
	Principal bucketPolicyPrincipal `json:"Principal"`
	Action    []string              `json:"Action"`
	Resource  []string              `json:"Resource"`
}

type bucketPolicyPrincipal struct {
	AWS []string `json:"AWS"`
}

func publicReadResources(cfg config.ObjectStorageConfig) []string {
	prefixes := []string{cfg.AvatarPrefix, cfg.SpecPrefix, cfg.RepoPrefix}
	resources := make([]string, 0, len(prefixes))
	seen := make(map[string]struct{}, len(prefixes))
	bucket := strings.Trim(cfg.Bucket, "/")
	for _, prefix := range prefixes {
		prefix = cleanObjectPrefix(prefix)
		if prefix == "" {
			continue
		}
		if _, ok := seen[prefix]; ok {
			continue
		}
		seen[prefix] = struct{}{}
		resources = append(resources, fmt.Sprintf("arn:aws:s3:::%s/%s/*", bucket, prefix))
	}
	return resources
}

func appendURLPath(base, key string) string {
	u, err := url.Parse(base)
	if err != nil {
		return strings.TrimRight(base, "/") + "/" + key
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/" + key
	return u.String()
}

func objectAccessBase(cfg config.ObjectStorageConfig) string {
	base := strings.TrimRight(strings.TrimSpace(cfg.AccessEndpoint), "/")
	if base == "" {
		base = strings.TrimRight(cfg.Endpoint, "/")
	}
	bucket := strings.Trim(cfg.Bucket, "/")
	if bucket == "" {
		return base
	}
	u, err := url.Parse(base)
	if err != nil {
		return strings.TrimRight(base, "/") + "/" + bucket
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) == 0 || parts[len(parts)-1] != bucket {
		u.Path = strings.TrimRight(u.Path, "/") + "/" + bucket
	}
	return u.String()
}

func presignSigningEndpoint(cfg config.ObjectStorageConfig) string {
	endpoint := strings.TrimSpace(cfg.AccessEndpoint)
	if endpoint == "" {
		return cfg.Endpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	u.Path = ""
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/")
}

func (c *Client) publicPresignURL(signedURL, key string) string {
	publicURL := appendURLPath(objectAccessBase(c.cfg), key)
	public, err := url.Parse(publicURL)
	if err != nil {
		return signedURL
	}
	signed, err := url.Parse(signedURL)
	if err != nil {
		return publicURL
	}
	public.RawQuery = signed.RawQuery
	return public.String()
}
