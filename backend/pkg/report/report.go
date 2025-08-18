package report

import (
	"encoding/json"
	"log/slog"
	"net/url"
	"os"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/pkg/aes"
	"github.com/chaitin/MonkeyCode/backend/pkg/machine"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
	"github.com/chaitin/MonkeyCode/backend/pkg/version"
)

type Reporter struct {
	client    *request.Client
	version   *version.VersionInfo
	logger    *slog.Logger
	IDFile    string
	machineID string
	cfg       *config.Config
}

func NewReport(logger *slog.Logger, cfg *config.Config, version *version.VersionInfo) *Reporter {
	raw := "https://baizhi.cloud"
	u, _ := url.Parse(raw)
	client := request.NewClient(u.Scheme, u.Host, 30*time.Second)

	// 从配置文件读取机器ID文件路径
	idFilePath := cfg.DataReport.MachineIDFile
	if idFilePath == "" {
		idFilePath = "/app/static/.machine_id"
	}
	r := &Reporter{
		client:  client,
		logger:  logger.With("module", "reporter"),
		IDFile:  idFilePath,
		cfg:     cfg,
		version: version,
	}
	if _, err := r.readMachineID(); err != nil {
		r.logger.With("error", err).Warn("read machine id file failed")
	}
	return r
}

func (r *Reporter) readMachineID() (string, error) {
	data, err := os.ReadFile(r.IDFile)
	if err != nil {
		return "", err
	}
	r.machineID = string(data)
	return r.machineID, nil
}

func (r *Reporter) Report(index string, data any) error {
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}

	encrypt, err := aes.Encrypt([]byte(r.cfg.DataReport.Key), string(b))
	if err != nil {
		return err
	}

	req := map[string]any{
		"index": index,
		"id":    uuid.NewString(),
		"data":  encrypt,
	}

	if _, err := request.Post[map[string]any](r.client, "/api/public/data/report", req); err != nil {
		r.logger.With("error", err).Warn("report installation failed")
		return err
	}

	return nil
}

func (r *Reporter) GetMachineID() string {
	return r.machineID
}

func (r *Reporter) ReportInstallation() error {
	// 先确保机器ID存在（无论是否上报数据）
	if err := r.ensureMachineID(); err != nil {
		return err
	}

	// 如果密钥为空，跳过数据上报，但机器ID已经生成
	if r.cfg.DataReport.Key == "" {
		r.logger.Info("data report disabled (empty key), but machine ID is ready")
		return nil
	}

	// 执行数据上报
	return r.Report("monkeycode-installation", InstallData{
		MachineID: r.machineID,
		Version:   r.version.Version(),
		Timestamp: time.Now().Format(time.RFC3339),
		Type:      "installation",
	})
}

// ensureMachineID 确保机器ID存在，如果不存在则生成并保存
func (r *Reporter) ensureMachineID() error {
	// 如果已经有机器ID，直接返回
	if r.machineID != "" {
		return nil
	}

	// 生成新的机器ID
	id, err := machine.GenerateMachineID()
	if err != nil {
		r.logger.With("error", err).Warn("generate machine id failed")
		return err
	}
	r.machineID = id

	// 保存到文件
	f, err := os.Create(r.IDFile)
	if err != nil {
		r.logger.With("error", err).Warn("create machine id file failed")
		return err
	}
	defer f.Close()

	_, err = f.WriteString(id)
	if err != nil {
		r.logger.With("error", err).Warn("write machine id file failed")
		return err
	}

	r.logger.Info("machine id generated and saved", "file", r.IDFile)
	return nil
}
