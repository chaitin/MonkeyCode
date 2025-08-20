package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/rule"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/queuerunner"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
	"github.com/chaitin/MonkeyCode/backend/pkg/scan"
)

type ProxyUsecase struct {
	repo         domain.ProxyRepo
	modelRepo    domain.ModelRepo
	securityRepo domain.SecurityScanningRepo
	logger       *slog.Logger
	queuerunner  *queuerunner.QueueRunner[domain.CreateSecurityScanningReq]
	client       *request.Client
}

func NewProxyUsecase(
	repo domain.ProxyRepo,
	modelRepo domain.ModelRepo,
	securityRepo domain.SecurityScanningRepo,
	logger *slog.Logger,
	cfg *config.Config,
	redis *redis.Client,
) domain.ProxyUsecase {
	client := request.NewClient("http", "monkeycode-scanner:8888", 30*time.Minute, request.WithTransport(&http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 100,
		MaxConnsPerHost:     100,
		IdleConnTimeout:     90 * time.Second,
		ForceAttemptHTTP2:   true,
	}))
	client.SetDebug(cfg.Debug)
	p := &ProxyUsecase{
		repo:         repo,
		modelRepo:    modelRepo,
		securityRepo: securityRepo,
		logger:       logger.With("module", "ProxyUsecase"),
		queuerunner:  queuerunner.NewQueueRunner[domain.CreateSecurityScanningReq](cfg, redis, logger),
		client:       client,
	}
	go p.queuerunner.Run(context.Background())
	go p.requeue()
	return p
}

func (p *ProxyUsecase) requeue() {
	scannings, err := p.securityRepo.AllRunning(context.Background())
	if err != nil {
		p.logger.With("fn", "requeue").With("error", err).ErrorContext(context.Background(), "failed to get running scannings")
		return
	}
	for _, scanning := range scannings {
		p.queuerunner.Enqueue(context.Background(), scanning.ID.String(), domain.CreateSecurityScanningReq{
			UserID:    scanning.UserID.String(),
			Workspace: scanning.Workspace,
			Language:  scanning.Language,
		}, p.TaskHandle)
	}
}

func (p *ProxyUsecase) Record(ctx context.Context, record *domain.RecordParam) error {
	return p.repo.Record(ctx, record)
}

// SelectModelWithLoadBalancing implements domain.ProxyUsecase.
func (p *ProxyUsecase) SelectModelWithLoadBalancing(modelName string, modelType consts.ModelType) (*domain.Model, error) {
	model, err := p.modelRepo.GetWithCache(context.Background(), modelType)
	if err != nil {
		return nil, err
	}
	return cvt.From(model, &domain.Model{}), nil
}

func (p *ProxyUsecase) ValidateApiKey(ctx context.Context, key string) (*domain.ApiKey, error) {
	apiKey, err := p.repo.ValidateApiKey(ctx, key)
	if err != nil {
		return nil, err
	}
	return cvt.From(apiKey, &domain.ApiKey{}), nil
}

func (p *ProxyUsecase) AcceptCompletion(ctx context.Context, req *domain.AcceptCompletionReq) error {
	return p.repo.AcceptCompletion(ctx, req)
}

func (p *ProxyUsecase) Report(ctx context.Context, req *domain.ReportReq) error {
	var model *db.Model
	var err error
	if req.Action == consts.ReportActionNewTask {
		model, err = p.modelRepo.GetWithCache(context.Background(), consts.ModelTypeLLM)
		if err != nil {
			p.logger.With("fn", "Report").With("error", err).ErrorContext(ctx, "failed to get model")
			return err
		}
	}
	return p.repo.Report(ctx, model, req)
}

func (p *ProxyUsecase) CreateSecurityScanning(ctx context.Context, req *domain.CreateSecurityScanningReq) (string, error) {
	id, err := p.securityRepo.Create(ctx, *req)
	if err != nil {
		return "", err
	}
	return p.queuerunner.Enqueue(ctx, id, *req, p.TaskHandle)
}

func (p *ProxyUsecase) TaskHandle(ctx context.Context, task *queuerunner.Task[domain.CreateSecurityScanningReq]) error {
	ctx = rule.SkipPermission(ctx)
	id := task.ID
	if err := p.securityRepo.Update(ctx, id, nil, consts.SecurityScanningStatusRunning, nil); err != nil {
		p.logger.With("id", task.ID).With("error", err).ErrorContext(ctx, "failed to update security scanning")
		return err
	}
	p.logger.With("id", id).DebugContext(ctx, "task started")

	// 落盘文件
	scanning, err := p.securityRepo.Get(ctx, id)
	if err != nil {
		p.logger.With("id", id).With("error", err).ErrorContext(ctx, "failed to get security scanning")
		return err
	}
	prefix := fmt.Sprintf("/app/static/codes/%s", id)
	rootPath := path.Join(prefix, scanning.Edges.WorkspaceEdge.RootPath)
	defer os.RemoveAll(prefix)

	fileMap := make(map[string]string)
	if err = p.securityRepo.PageWorkspaceFiles(ctx, scanning.WorkspaceID.String(), 20, func(rs []*db.WorkspaceFile) error {
		for _, r := range rs {
			filename := path.Join(rootPath, r.Path)
			dir := path.Dir(filename)
			p.logger.With("path", dir).DebugContext(ctx, "create dir")
			if err = os.MkdirAll(dir, 0755); err != nil {
				p.logger.With("path", dir).With("id", id).With("error", err).ErrorContext(ctx, "failed to create dir")
				continue
			}
			if err = os.WriteFile(filename, []byte(r.Content), 0644); err != nil {
				p.logger.With("path", filename).With("id", id).With("error", err).ErrorContext(ctx, "failed to write file")
				continue
			}
			fileMap[filename] = r.Content
		}
		return nil
	}); err != nil {
		return err
	}

	result, err := request.Post[scan.Result](p.client, "/api/v1/scan", domain.ScanReq{
		TaskID:    task.ID,
		UserID:    task.Data.UserID,
		Workspace: rootPath,
		Language:  task.Data.Language.Rule(),
	})

	if err != nil {
		if err = p.securityRepo.Update(ctx, id, fileMap, consts.SecurityScanningStatusFailed, &scan.Result{
			Output: err.Error(),
		}); err != nil {
			p.logger.With("id", task.ID).With("error", err).ErrorContext(ctx, "failed to update security scanning")
		}
		p.logger.With("id", task.ID).With("error", err).ErrorContext(ctx, "failed to scan")
		return err
	}

	result.Prefix = prefix
	if err := p.securityRepo.Update(ctx, id, fileMap, consts.SecurityScanningStatusSuccess, result); err != nil {
		p.logger.With("id", task.ID).With("error", err).ErrorContext(ctx, "failed to update security scanning")
		return err
	}

	p.logger.With("id", task.ID).DebugContext(ctx, "task done")
	return nil
}

func (p *ProxyUsecase) ListSecurityScanning(ctx context.Context, req *domain.ListSecurityScanningReq) (*domain.ListSecurityScanningBriefResp, error) {
	return p.securityRepo.ListBrief(ctx, *req)
}

func (p *ProxyUsecase) ListSecurityDetail(ctx context.Context, req *domain.ListSecurityScanningDetailReq) (*domain.ListSecurityScanningDetailResp, error) {
	return p.securityRepo.ListDetail(ctx, *req)
}
