package proto

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
)

const (
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type RegisterRequest struct {
	Token    string `json:"token,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	Ip       string `json:"ip,omitempty"`
	Cores    int32  `json:"cores,omitempty"`
	Memory   int64  `json:"memory,omitempty"`
	Disk     int64  `json:"disk,omitempty"`
}

func (x *RegisterRequest) Reset()         { *x = RegisterRequest{} }
func (x *RegisterRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*RegisterRequest) ProtoMessage()    {}
func (x *RegisterRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *RegisterRequest) GetToken() string    { return x.Token }
func (x *RegisterRequest) GetHostname() string { return x.Hostname }
func (x *RegisterRequest) GetIp() string       { return x.Ip }
func (x *RegisterRequest) GetCores() int32     { return x.Cores }
func (x *RegisterRequest) GetMemory() int64    { return x.Memory }
func (x *RegisterRequest) GetDisk() int64      { return x.Disk }

type RegisterResponse struct {
	RunnerId string `json:"runner_id,omitempty"`
	Success  bool   `json:"success,omitempty"`
	Message  string `json:"message,omitempty"`
}

func (x *RegisterResponse) Reset()         { *x = RegisterResponse{} }
func (x *RegisterResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*RegisterResponse) ProtoMessage()    {}
func (x *RegisterResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *RegisterResponse) GetRunnerId() string { return x.RunnerId }
func (x *RegisterResponse) GetSuccess() bool    { return x.Success }
func (x *RegisterResponse) GetMessage() string  { return x.Message }

type HeartbeatRequest struct {
	RunnerId     string `json:"runner_id,omitempty"`
	Timestamp    int64  `json:"timestamp,omitempty"`
	RunningVms   int32  `json:"running_vms,omitempty"`
	RunningTasks int32  `json:"running_tasks,omitempty"`
}

func (x *HeartbeatRequest) Reset()         { *x = HeartbeatRequest{} }
func (x *HeartbeatRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*HeartbeatRequest) ProtoMessage()    {}
func (x *HeartbeatRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[2]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *HeartbeatRequest) GetRunnerId() string     { return x.RunnerId }
func (x *HeartbeatRequest) GetTimestamp() int64     { return x.Timestamp }
func (x *HeartbeatRequest) GetRunningVms() int32    { return x.RunningVms }
func (x *HeartbeatRequest) GetRunningTasks() int32  { return x.RunningTasks }

type HeartbeatResponse struct {
	Success bool `json:"success,omitempty"`
}

func (x *HeartbeatResponse) Reset()         { *x = HeartbeatResponse{} }
func (x *HeartbeatResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*HeartbeatResponse) ProtoMessage()    {}
func (x *HeartbeatResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[3]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *HeartbeatResponse) GetSuccess() bool { return x.Success }

type CreateVMRequest struct {
	VmId       string            `json:"vm_id,omitempty"`
	UserId     string            `json:"user_id,omitempty"`
	ImageUrl   string            `json:"image_url,omitempty"`
	GitUrl     string            `json:"git_url,omitempty"`
	GitToken   string            `json:"git_token,omitempty"`
	Cores      int32             `json:"cores,omitempty"`
	Memory     int64             `json:"memory,omitempty"`
	EnvVars    map[string]string `json:"env_vars,omitempty"`
	TtlSeconds int64             `json:"ttl_seconds,omitempty"`
}

func (x *CreateVMRequest) Reset()         { *x = CreateVMRequest{} }
func (x *CreateVMRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*CreateVMRequest) ProtoMessage()    {}
func (x *CreateVMRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[4]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *CreateVMRequest) GetVmId() string               { return x.VmId }
func (x *CreateVMRequest) GetUserId() string             { return x.UserId }
func (x *CreateVMRequest) GetImageUrl() string           { return x.ImageUrl }
func (x *CreateVMRequest) GetGitUrl() string             { return x.GitUrl }
func (x *CreateVMRequest) GetGitToken() string           { return x.GitToken }
func (x *CreateVMRequest) GetCores() int32               { return x.Cores }
func (x *CreateVMRequest) GetMemory() int64              { return x.Memory }
func (x *CreateVMRequest) GetEnvVars() map[string]string { return x.EnvVars }
func (x *CreateVMRequest) GetTtlSeconds() int64          { return x.TtlSeconds }

type CreateVMResponse struct {
	VmId        string `json:"vm_id,omitempty"`
	ContainerId string `json:"container_id,omitempty"`
	Success     bool   `json:"success,omitempty"`
	Message     string `json:"message,omitempty"`
}

func (x *CreateVMResponse) Reset()         { *x = CreateVMResponse{} }
func (x *CreateVMResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*CreateVMResponse) ProtoMessage()    {}
func (x *CreateVMResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[5]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *CreateVMResponse) GetVmId() string        { return x.VmId }
func (x *CreateVMResponse) GetContainerId() string { return x.ContainerId }
func (x *CreateVMResponse) GetSuccess() bool       { return x.Success }
func (x *CreateVMResponse) GetMessage() string     { return x.Message }

type DeleteVMRequest struct {
	VmId     string `json:"vm_id,omitempty"`
	RunnerId string `json:"runner_id,omitempty"`
}

func (x *DeleteVMRequest) Reset()         { *x = DeleteVMRequest{} }
func (x *DeleteVMRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*DeleteVMRequest) ProtoMessage()    {}
func (x *DeleteVMRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[6]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *DeleteVMRequest) GetVmId() string     { return x.VmId }
func (x *DeleteVMRequest) GetRunnerId() string { return x.RunnerId }

type DeleteVMResponse struct {
	Success bool   `json:"success,omitempty"`
	Message string `json:"message,omitempty"`
}

func (x *DeleteVMResponse) Reset()         { *x = DeleteVMResponse{} }
func (x *DeleteVMResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*DeleteVMResponse) ProtoMessage()    {}
func (x *DeleteVMResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[7]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *DeleteVMResponse) GetSuccess() bool   { return x.Success }
func (x *DeleteVMResponse) GetMessage() string { return x.Message }

type VMInfo struct {
	Id          string `json:"id,omitempty"`
	ContainerId string `json:"container_id,omitempty"`
	Status      string `json:"status,omitempty"`
	CreatedAt   int64  `json:"created_at,omitempty"`
}

func (x *VMInfo) Reset()         { *x = VMInfo{} }
func (x *VMInfo) String() string { return protoimpl.X.MessageStringOf(x) }
func (*VMInfo) ProtoMessage()    {}
func (x *VMInfo) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[8]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *VMInfo) GetId() string          { return x.Id }
func (x *VMInfo) GetContainerId() string { return x.ContainerId }
func (x *VMInfo) GetStatus() string      { return x.Status }
func (x *VMInfo) GetCreatedAt() int64    { return x.CreatedAt }

type ListVMsRequest struct {
	RunnerId string `json:"runner_id,omitempty"`
}

func (x *ListVMsRequest) Reset()         { *x = ListVMsRequest{} }
func (x *ListVMsRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*ListVMsRequest) ProtoMessage()    {}
func (x *ListVMsRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[9]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *ListVMsRequest) GetRunnerId() string { return x.RunnerId }

type ListVMsResponse struct {
	Vms []*VMInfo `json:"vms,omitempty"`
}

func (x *ListVMsResponse) Reset()         { *x = ListVMsResponse{} }
func (x *ListVMsResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*ListVMsResponse) ProtoMessage()    {}
func (x *ListVMsResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[10]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *ListVMsResponse) GetVms() []*VMInfo { return x.Vms }

type GetVMInfoRequest struct {
	VmId string `json:"vm_id,omitempty"`
}

func (x *GetVMInfoRequest) Reset()         { *x = GetVMInfoRequest{} }
func (x *GetVMInfoRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*GetVMInfoRequest) ProtoMessage()    {}
func (x *GetVMInfoRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[11]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *GetVMInfoRequest) GetVmId() string { return x.VmId }

type GetVMInfoResponse struct {
	Vm *VMInfo `json:"vm,omitempty"`
}

func (x *GetVMInfoResponse) Reset()         { *x = GetVMInfoResponse{} }
func (x *GetVMInfoResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*GetVMInfoResponse) ProtoMessage()    {}
func (x *GetVMInfoResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[12]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *GetVMInfoResponse) GetVm() *VMInfo { return x.Vm }

type CreateTaskRequest struct {
	TaskId  string            `json:"task_id,omitempty"`
	VmId    string            `json:"vm_id,omitempty"`
	Text    string            `json:"text,omitempty"`
	Model   string            `json:"model,omitempty"`
	ApiKey  string            `json:"api_key,omitempty"`
	BaseUrl string            `json:"base_url,omitempty"`
	EnvVars map[string]string `json:"env_vars,omitempty"`
}

func (x *CreateTaskRequest) Reset()         { *x = CreateTaskRequest{} }
func (x *CreateTaskRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*CreateTaskRequest) ProtoMessage()    {}
func (x *CreateTaskRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[13]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *CreateTaskRequest) GetTaskId() string            { return x.TaskId }
func (x *CreateTaskRequest) GetVmId() string              { return x.VmId }
func (x *CreateTaskRequest) GetText() string              { return x.Text }
func (x *CreateTaskRequest) GetModel() string             { return x.Model }
func (x *CreateTaskRequest) GetApiKey() string            { return x.ApiKey }
func (x *CreateTaskRequest) GetBaseUrl() string           { return x.BaseUrl }
func (x *CreateTaskRequest) GetEnvVars() map[string]string { return x.EnvVars }

type CreateTaskResponse struct {
	Success bool   `json:"success,omitempty"`
	Message string `json:"message,omitempty"`
}

func (x *CreateTaskResponse) Reset()         { *x = CreateTaskResponse{} }
func (x *CreateTaskResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*CreateTaskResponse) ProtoMessage()    {}
func (x *CreateTaskResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[14]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *CreateTaskResponse) GetSuccess() bool   { return x.Success }
func (x *CreateTaskResponse) GetMessage() string { return x.Message }

type StopTaskRequest struct {
	TaskId string `json:"task_id,omitempty"`
	VmId   string `json:"vm_id,omitempty"`
}

func (x *StopTaskRequest) Reset()         { *x = StopTaskRequest{} }
func (x *StopTaskRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*StopTaskRequest) ProtoMessage()    {}
func (x *StopTaskRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[15]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *StopTaskRequest) GetTaskId() string { return x.TaskId }
func (x *StopTaskRequest) GetVmId() string   { return x.VmId }

type StopTaskResponse struct {
	Success bool   `json:"success,omitempty"`
	Message string `json:"message,omitempty"`
}

func (x *StopTaskResponse) Reset()         { *x = StopTaskResponse{} }
func (x *StopTaskResponse) String() string { return protoimpl.X.MessageStringOf(x) }
func (*StopTaskResponse) ProtoMessage()    {}
func (x *StopTaskResponse) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[16]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *StopTaskResponse) GetSuccess() bool   { return x.Success }
func (x *StopTaskResponse) GetMessage() string { return x.Message }

type TerminalData struct {
	VmId       string          `json:"vm_id,omitempty"`
	TerminalId string          `json:"terminal_id,omitempty"`
	Data       []byte          `json:"data,omitempty"`
	Resize     *TerminalResize `json:"resize,omitempty"`
}

func (x *TerminalData) Reset()         { *x = TerminalData{} }
func (x *TerminalData) String() string { return protoimpl.X.MessageStringOf(x) }
func (*TerminalData) ProtoMessage()    {}
func (x *TerminalData) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[17]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *TerminalData) GetVmId() string            { return x.VmId }
func (x *TerminalData) GetTerminalId() string      { return x.TerminalId }
func (x *TerminalData) GetData() []byte            { return x.Data }
func (x *TerminalData) GetResize() *TerminalResize { return x.Resize }

type TerminalResize struct {
	Cols uint32 `json:"cols,omitempty"`
	Rows uint32 `json:"rows,omitempty"`
}

func (x *TerminalResize) Reset()         { *x = TerminalResize{} }
func (x *TerminalResize) String() string { return protoimpl.X.MessageStringOf(x) }
func (*TerminalResize) ProtoMessage()    {}
func (x *TerminalResize) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[18]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *TerminalResize) GetCols() uint32 { return x.Cols }
func (x *TerminalResize) GetRows() uint32 { return x.Rows }

type ReportRequest struct {
	TaskId string `json:"task_id,omitempty"`
}

func (x *ReportRequest) Reset()         { *x = ReportRequest{} }
func (x *ReportRequest) String() string { return protoimpl.X.MessageStringOf(x) }
func (*ReportRequest) ProtoMessage()    {}
func (x *ReportRequest) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[19]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *ReportRequest) GetTaskId() string { return x.TaskId }

type ReportEntry struct {
	TaskId    string `json:"task_id,omitempty"`
	Source    string `json:"source,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	Data      []byte `json:"data,omitempty"`
}

func (x *ReportEntry) Reset()         { *x = ReportEntry{} }
func (x *ReportEntry) String() string { return protoimpl.X.MessageStringOf(x) }
func (*ReportEntry) ProtoMessage()    {}
func (x *ReportEntry) ProtoReflect() protoreflect.Message {
	mi := &file_taskflow_proto_msgTypes[20]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}
func (x *ReportEntry) GetTaskId() string    { return x.TaskId }
func (x *ReportEntry) GetSource() string    { return x.Source }
func (x *ReportEntry) GetTimestamp() int64  { return x.Timestamp }
func (x *ReportEntry) GetData() []byte      { return x.Data }

var File_taskflow_proto protoreflect.FileDescriptor

var file_taskflow_proto_msgTypes = make([]protoimpl.MessageInfo, 21)
