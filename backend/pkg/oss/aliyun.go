package oss

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// AliyunClient is a narrow OSS client backed by aliyun-oss-go-sdk. It exists
// alongside the AWS-SDK-v2 backed Client so the agent-resources read path can
// hit Aliyun OSS without going through the AWS S3 SigV4 signer (Aliyun rejects
// SigV4 with SignatureDoesNotMatch and the path-style URL it produces double-
// prefixes the bucket).
//
// Implements just GetObject + PresignGet — the surface agentresource.Resolver
// needs. Existing avatar/repo/spec/temp upload flows keep using the AWS-SDK
// backed *Client.
type AliyunClient struct {
	bucket *oss.Bucket
}

// NewAliyunOSS builds an AliyunClient from the shared aliyun.public_oss block.
// Empty Endpoint / Bucket / AccessKey / AccessKeySecret is a hard error so
// misconfigured deploys fail fast at DI resolution time rather than at first
// presign attempt.
func NewAliyunOSS(cfg config.AliyunOSSConfig) (*AliyunClient, error) {
	if cfg.Endpoint == "" {
		return nil, errors.New("aliyun oss: empty Endpoint")
	}
	if cfg.Bucket == "" {
		return nil, errors.New("aliyun oss: empty Bucket")
	}
	if cfg.AccessKey == "" || cfg.AccessKeySecret == "" {
		return nil, errors.New("aliyun oss: empty AccessKey/AccessKeySecret")
	}
	client, err := oss.New(cfg.Endpoint, cfg.AccessKey, cfg.AccessKeySecret)
	if err != nil {
		return nil, fmt.Errorf("aliyun oss: new client: %w", err)
	}
	bucket, err := client.Bucket(cfg.Bucket)
	if err != nil {
		return nil, fmt.Errorf("aliyun oss: open bucket %q: %w", cfg.Bucket, err)
	}
	return &AliyunClient{bucket: bucket}, nil
}

// GetObject downloads the object body at the given key (relative to the
// bucket — no extra prefix is applied). Caller closes the ReadCloser.
func (c *AliyunClient) GetObject(_ context.Context, key string) (io.ReadCloser, error) {
	body, err := c.bucket.GetObject(key)
	if err != nil {
		return nil, fmt.Errorf("aliyun oss: get %q: %w", key, err)
	}
	return body, nil
}

// PresignGet returns a presigned GET URL valid for `expires`. The aliyun SDK
// signs with `OSS4-HMAC-SHA256` (or v1 depending on endpoint), which OSS
// accepts. Aliyun SDK takes expiry as seconds; we floor sub-second values to 1
// so a defensively-zero ttl doesn't break.
func (c *AliyunClient) PresignGet(_ context.Context, key string, expires time.Duration) (string, error) {
	seconds := int64(expires.Seconds())
	if seconds < 1 {
		seconds = 1
	}
	url, err := c.bucket.SignURL(key, oss.HTTPGet, seconds)
	if err != nil {
		return "", fmt.Errorf("aliyun oss: presign %q: %w", key, err)
	}
	return url, nil
}
