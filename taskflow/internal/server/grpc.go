package server

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	pb "github.com/chaitin/MonkeyCode/taskflow/pkg/proto"
	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type GRPCServer struct {
	pb.UnimplementedRunnerServiceServer
	store   *store.RedisStore
	manager *runner.Manager
	logger  *slog.Logger
}

func NewGRPCServer(s *store.RedisStore, m *runner.Manager, logger *slog.Logger) *GRPCServer {
	return &GRPCServer{
		store:   s,
		manager: m,
		logger:  logger,
	}
}

func (s *GRPCServer) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	s.logger.Info("runner registering", "hostname", req.Hostname, "ip", req.Ip)

	runnerID := uuid.New().String()

	r := &store.Runner{
		ID:       runnerID,
		Hostname: req.Hostname,
		IP:       req.Ip,
		Status:   "online",
		LastSeen: time.Now().Unix(),
		Capacity: map[string]int64{
			"cores":  int64(req.Cores),
			"memory": req.Memory,
			"disk":   req.Disk,
		},
	}

	if err := s.store.RegisterRunner(ctx, r, 60*time.Second); err != nil {
		s.logger.Error("failed to register runner", "error", err)
		return nil, err
	}

	if err := s.manager.Register(ctx, runnerID, ""); err != nil {
		s.logger.Error("failed to register runner in manager", "error", err)
	}

	s.logger.Info("runner registered", "runner_id", runnerID)

	return &pb.RegisterResponse{
		RunnerId: runnerID,
		Success:  true,
		Message:  "registered successfully",
	}, nil
}

func (s *GRPCServer) Heartbeat(ctx context.Context, req *pb.HeartbeatRequest) (*pb.HeartbeatResponse, error) {
	s.manager.UpdateHeartbeat(req.RunnerId)

	r, err := s.store.GetRunner(ctx, req.RunnerId)
	if err != nil {
		s.logger.Warn("heartbeat from unknown runner", "runner_id", req.RunnerId)
		return &pb.HeartbeatResponse{Success: false}, nil
	}

	r.LastSeen = time.Now().Unix()
	if err := s.store.RegisterRunner(ctx, r, 60*time.Second); err != nil {
		s.logger.Error("failed to update runner heartbeat", "error", err)
		return nil, err
	}

	return &pb.HeartbeatResponse{Success: true}, nil
}

func (s *GRPCServer) CreateVM(ctx context.Context, req *pb.CreateVMRequest) (*pb.CreateVMResponse, error) {
	s.logger.Info("creating vm", "vm_id", req.VmId, "user_id", req.UserId)

	vm := &store.VM{
		ID:        req.VmId,
		UserID:    req.UserId,
		Status:    "pending",
		CreatedAt: time.Now().Unix(),
		ImageURL:  req.ImageUrl,
		GitURL:    req.GitUrl,
	}

	if err := s.store.SetVM(ctx, vm); err != nil {
		s.logger.Error("failed to create vm", "error", err)
		return nil, err
	}

	if err := s.store.AddUserVM(ctx, req.UserId, req.VmId); err != nil {
		s.logger.Error("failed to add user vm", "error", err)
	}

	return &pb.CreateVMResponse{
		VmId:    req.VmId,
		Success: true,
		Message: "vm created",
	}, nil
}

func (s *GRPCServer) DeleteVM(ctx context.Context, req *pb.DeleteVMRequest) (*pb.DeleteVMResponse, error) {
	s.logger.Info("deleting vm", "vm_id", req.VmId)

	if err := s.store.DeleteVM(ctx, req.VmId); err != nil {
		s.logger.Error("failed to delete vm", "error", err)
		return &pb.DeleteVMResponse{Success: false, Message: err.Error()}, nil
	}

	return &pb.DeleteVMResponse{Success: true, Message: "vm deleted"}, nil
}

func (s *GRPCServer) ListVMs(ctx context.Context, req *pb.ListVMsRequest) (*pb.ListVMsResponse, error) {
	s.logger.Debug("listing vms", "runner_id", req.RunnerId)

	return &pb.ListVMsResponse{Vms: []*pb.VMInfo{}}, nil
}

func (s *GRPCServer) GetVMInfo(ctx context.Context, req *pb.GetVMInfoRequest) (*pb.GetVMInfoResponse, error) {
	s.logger.Debug("getting vm info", "vm_id", req.VmId)

	vm, err := s.store.GetVM(ctx, req.VmId)
	if err != nil {
		return nil, err
	}

	return &pb.GetVMInfoResponse{
		Vm: &pb.VMInfo{
			Id:          vm.ID,
			ContainerId: vm.ContainerID,
			Status:      vm.Status,
			CreatedAt:   vm.CreatedAt,
		},
	}, nil
}

func (s *GRPCServer) CreateTask(ctx context.Context, req *pb.CreateTaskRequest) (*pb.CreateTaskResponse, error) {
	s.logger.Info("creating task", "task_id", req.TaskId, "vm_id", req.VmId)

	task := &store.Task{
		ID:        req.TaskId,
		VMID:      req.VmId,
		Status:    "pending",
		Agent:     req.Model,
		CreatedAt: time.Now().Unix(),
	}

	if err := s.store.SetTask(ctx, task); err != nil {
		s.logger.Error("failed to create task", "error", err)
		return nil, err
	}

	return &pb.CreateTaskResponse{Success: true, Message: "task created"}, nil
}

func (s *GRPCServer) StopTask(ctx context.Context, req *pb.StopTaskRequest) (*pb.StopTaskResponse, error) {
	s.logger.Info("stopping task", "task_id", req.TaskId)

	task, err := s.store.GetTask(ctx, req.TaskId)
	if err != nil {
		return nil, err
	}

	task.Status = "stopped"
	if err := s.store.SetTask(ctx, task); err != nil {
		s.logger.Error("failed to stop task", "error", err)
		return nil, err
	}

	return &pb.StopTaskResponse{Success: true, Message: "task stopped"}, nil
}

func (s *GRPCServer) TerminalStream(stream pb.RunnerService_TerminalStreamServer) error {
	for {
		data, err := stream.Recv()
		if err != nil {
			return err
		}
		s.logger.Debug("terminal data", "vm_id", data.VmId, "terminal_id", data.TerminalId)
		if err := stream.Send(data); err != nil {
			return err
		}
	}
}

func (s *GRPCServer) ReportStream(req *pb.ReportRequest, stream pb.RunnerService_ReportStreamServer) error {
	for {
		entry := &pb.ReportEntry{
			TaskId:    req.TaskId,
			Source:    "taskflow",
			Timestamp: time.Now().Unix(),
			Data:      []byte("report entry"),
		}
		if err := stream.Send(entry); err != nil {
			return err
		}
		time.Sleep(1 * time.Second)
	}
}
