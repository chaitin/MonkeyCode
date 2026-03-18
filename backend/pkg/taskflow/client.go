package taskflow

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// ==================== 接口定义 ====================

// Clienter taskflow 客户端接口
type Clienter interface {
	VirtualMachiner() VirtualMachiner
	Host() Hoster
	PortForwarder() PortForwarder
	TaskManager() TaskManager
}

// TaskManager 任务管理接口
type TaskManager interface {
	Create(ctx context.Context, req CreateVirtualMachineReq) error
	Stop(ctx context.Context, req TaskReq) error
	Restart(ctx context.Context, req RestartTaskReq) error
	Cancel(ctx context.Context, req TaskReq) error
	Continue(ctx context.Context, req TaskReq) error
	AutoApprove(ctx context.Context, req TaskApproveReq) error
	AskUserQuestion(ctx context.Context, req AskUserQuestionResponse) error
	ListFiles(ctx context.Context, req RepoListFilesReq) (*RepoListFiles, error)
	ReadFile(ctx context.Context, req RepoReadFileReq) (*RepoReadFile, error)
	FileDiff(ctx context.Context, req RepoFileDiffReq) (*RepoFileDiff, error)
	FileChanges(ctx context.Context, req RepoFileChangesReq) (*RepoFileChanges, error)
}

// Sheller 终端 shell 接口
type Sheller interface {
	Write(TerminalData) error
	Stop()
	BlockRead(fn func(TerminalData)) error
}

// Hoster 宿主机管理接口
type Hoster interface {
	List(ctx context.Context, userID string) (map[string]*Host, error)
	IsOnline(ctx context.Context, req *IsOnlineReq[string]) (*IsOnlineResp, error)
}

// VirtualMachiner 虚拟机管理接口
type VirtualMachiner interface {
	Create(ctx context.Context, req *CreateVirtualMachineReq) (*VirtualMachine, error)
	Delete(ctx context.Context, req *DeleteVirtualMachineReq) error
	Terminal(ctx context.Context, req *TerminalReq) (Sheller, error)
	TerminalList(ctx context.Context, id string) ([]*Terminal, error)
	CloseTerminal(ctx context.Context, req *CloseTerminalReq) error
	IsOnline(ctx context.Context, req *IsOnlineReq[string]) (*IsOnlineResp, error)
}

// PortForwarder 端口转发管理接口
type PortForwarder interface {
	List(ctx context.Context, id string) ([]*PortForwardInfo, error)
	Create(ctx context.Context, req CreatePortForward) (*PortForwardInfo, error)
	Close(ctx context.Context, req ClosePortForward) error
	Update(ctx context.Context, req UpdatePortForward) (*PortForwardInfo, error)
}

// ==================== 客户端实现 ====================

// Client taskflow 客户端
type Client struct {
	client            *request.Client
	hostclient        Hoster
	vmclient          VirtualMachiner
	portForwardClient PortForwarder
	taskManagerClient TaskManager
	logger            *slog.Logger
}

// Opt 客户端选项
type Opt func(*Client)

// WithLogger 设置日志
func WithLogger(logger *slog.Logger) Opt {
	return func(c *Client) {
		c.logger = logger
	}
}

// WithDebug 开启调试模式
func WithDebug(debug bool) Opt {
	return func(c *Client) {
		c.client.SetDebug(debug)
	}
}

// NewClient 创建 taskflow 客户端
func NewClient(opts ...Opt) Clienter {
	server := os.Getenv("TASKFLOW_SERVER")
	if server == "" {
		panic(fmt.Errorf("TASKFLOW_SERVER must be set"))
	}

	u, err := url.Parse(server)
	if err != nil {
		panic(fmt.Errorf("TASKFLOW_SERVER is not a valid URL: %v", err))
	}

	httpclient := &http.Client{
		Timeout: time.Second * 30,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			MaxConnsPerHost:     100,
			IdleConnTimeout:     time.Second * 30,
		},
	}

	client := request.NewClient(u.Scheme, u.Host, 15*time.Second, request.WithClient(httpclient))
	c := &Client{
		client: client,
		logger: slog.Default(),
	}
	for _, opt := range opts {
		opt(c)
	}
	c.client.SetLogger(c.logger)
	c.vmclient = newVirtualMachineClient(c.client)
	c.hostclient = newHostClient(c.client)
	c.portForwardClient = newPortForwardClient(c.client)
	c.taskManagerClient = newTaskManagerClient(c.client)

	return c
}

func (c *Client) VirtualMachiner() VirtualMachiner { return c.vmclient }
func (c *Client) Host() Hoster                     { return c.hostclient }
func (c *Client) PortForwarder() PortForwarder      { return c.portForwardClient }
func (c *Client) TaskManager() TaskManager           { return c.taskManagerClient }
