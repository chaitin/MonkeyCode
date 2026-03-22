package client

import (
	"context"
	"log/slog"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pb "github.com/chaitin/MonkeyCode/taskflow/pkg/proto"
)

type Client struct {
	conn   *grpc.ClientConn
	client pb.RunnerServiceClient
	logger *slog.Logger
}

func New(addr string, logger *slog.Logger) (*Client, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}

	return &Client{
		conn:   conn,
		client: pb.NewRunnerServiceClient(conn),
		logger: logger,
	}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) Register(ctx context.Context, token, hostname, ip string, cores int32, memory, disk int64) (string, error) {
	resp, err := c.client.Register(ctx, &pb.RegisterRequest{
		Token:    token,
		Hostname: hostname,
		Ip:       ip,
		Cores:    cores,
		Memory:   memory,
		Disk:     disk,
	})
	if err != nil {
		return "", err
	}
	return resp.RunnerId, nil
}

func (c *Client) Heartbeat(ctx context.Context, runnerID string, runningVMs, runningTasks int32) error {
	_, err := c.client.Heartbeat(ctx, &pb.HeartbeatRequest{
		RunnerId:     runnerID,
		Timestamp:    time.Now().Unix(),
		RunningVms:   runningVMs,
		RunningTasks: runningTasks,
	})
	return err
}

func (c *Client) CreateVM(ctx context.Context, req *pb.CreateVMRequest) (*pb.CreateVMResponse, error) {
	return c.client.CreateVM(ctx, req)
}

func (c *Client) DeleteVM(ctx context.Context, req *pb.DeleteVMRequest) (*pb.DeleteVMResponse, error) {
	return c.client.DeleteVM(ctx, req)
}

func (c *Client) ListVMs(ctx context.Context, req *pb.ListVMsRequest) (*pb.ListVMsResponse, error) {
	return c.client.ListVMs(ctx, req)
}

func (c *Client) CreateTask(ctx context.Context, req *pb.CreateTaskRequest) (*pb.CreateTaskResponse, error) {
	return c.client.CreateTask(ctx, req)
}

func (c *Client) StopTask(ctx context.Context, req *pb.StopTaskRequest) (*pb.StopTaskResponse, error) {
	return c.client.StopTask(ctx, req)
}
