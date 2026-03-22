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
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Token    string `protobuf:"bytes,1,opt,name=token,proto3" json:"token,omitempty"`
	Hostname string `protobuf:"bytes,2,opt,name=hostname,proto3" json:"hostname,omitempty"`
	Ip       string `protobuf:"bytes,3,opt,name=ip,proto3" json:"ip,omitempty"`
	Cores    int32  `protobuf:"varint,4,opt,name=cores,proto3" json:"cores,omitempty"`
	Memory   int64  `protobuf:"varint,5,opt,name=memory,proto3" json:"memory,omitempty"`
	Disk     int64  `protobuf:"varint,6,opt,name=disk,proto3" json:"disk,omitempty"`
}

func (x *RegisterRequest) Reset() {
	*x = RegisterRequest{}
}

func (x *RegisterRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RegisterRequest) ProtoMessage() {}

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

func (x *RegisterRequest) GetToken() string {
	if x != nil {
		return x.Token
	}
	return ""
}

func (x *RegisterRequest) GetHostname() string {
	if x != nil {
		return x.Hostname
	}
	return ""
}

func (x *RegisterRequest) GetIp() string {
	if x != nil {
		return x.Ip
	}
	return ""
}

func (x *RegisterRequest) GetCores() int32 {
	if x != nil {
		return x.Cores
	}
	return 0
}

func (x *RegisterRequest) GetMemory() int64 {
	if x != nil {
		return x.Memory
	}
	return 0
}

func (x *RegisterRequest) GetDisk() int64 {
	if x != nil {
		return x.Disk
	}
	return 0
}

type RegisterResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	RunnerId string `protobuf:"bytes,1,opt,name=runner_id,json=runnerId,proto3" json:"runner_id,omitempty"`
	Success  bool   `protobuf:"varint,2,opt,name=success,proto3" json:"success,omitempty"`
	Message  string `protobuf:"bytes,3,opt,name=message,proto3" json:"message,omitempty"`
}

func (x *RegisterResponse) Reset() {
	*x = RegisterResponse{}
}

func (x *RegisterResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*RegisterResponse) ProtoMessage() {}

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

func (x *RegisterResponse) GetRunnerId() string {
	if x != nil {
		return x.RunnerId
	}
	return ""
}

func (x *RegisterResponse) GetSuccess() bool {
	if x != nil {
		return x.Success
	}
	return false
}

func (x *RegisterResponse) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

type HeartbeatRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	RunnerId     string `protobuf:"bytes,1,opt,name=runner_id,json=runnerId,proto3" json:"runner_id,omitempty"`
	Timestamp    int64  `protobuf:"varint,2,opt,name=timestamp,proto3" json:"timestamp,omitempty"`
	RunningVms   int32  `protobuf:"varint,3,opt,name=running_vms,json=runningVms,proto3" json:"running_vms,omitempty"`
	RunningTasks int32  `protobuf:"varint,4,opt,name=running_tasks,json=runningTasks,proto3" json:"running_tasks,omitempty"`
}

func (x *HeartbeatRequest) Reset() {
	*x = HeartbeatRequest{}
}

func (x *HeartbeatRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*HeartbeatRequest) ProtoMessage() {}

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

func (x *HeartbeatRequest) GetRunnerId() string {
	if x != nil {
		return x.RunnerId
	}
	return ""
}

func (x *HeartbeatRequest) GetTimestamp() int64 {
	if x != nil {
		return x.Timestamp
	}
	return 0
}

func (x *HeartbeatRequest) GetRunningVms() int32 {
	if x != nil {
		return x.RunningVms
	}
	return 0
}

func (x *HeartbeatRequest) GetRunningTasks() int32 {
	if x != nil {
		return x.RunningTasks
	}
	return 0
}

type HeartbeatResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Success bool `protobuf:"varint,1,opt,name=success,proto3" json:"success,omitempty"`
}

func (x *HeartbeatResponse) Reset() {
	*x = HeartbeatResponse{}
}

func (x *HeartbeatResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*HeartbeatResponse) ProtoMessage() {}

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

func (x *HeartbeatResponse) GetSuccess() bool {
	if x != nil {
		return x.Success
	}
	return false
}

type CreateVMRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	VmId       string            `protobuf:"bytes,1,opt,name=vm_id,json=vmId,proto3" json:"vm_id,omitempty"`
	UserId     string            `protobuf:"bytes,2,opt,name=user_id,json=userId,proto3" json:"user_id,omitempty"`
	ImageUrl   string            `protobuf:"bytes,3,opt,name=image_url,json=imageUrl,proto3" json:"image_url,omitempty"`
	GitUrl     string            `protobuf:"bytes,4,opt,name=git_url,json=gitUrl,proto3" json:"git_url,omitempty"`
	GitToken   string            `protobuf:"bytes,5,opt,name=git_token,json=gitToken,proto3" json:"git_token,omitempty"`
	Cores      int32             `protobuf:"varint,6,opt,name=cores,proto3" json:"cores,omitempty"`
	Memory     int64             `protobuf:"varint,7,opt,name=memory,proto3" json:"memory,omitempty"`
	EnvVars    map[string]string `protobuf:"bytes,8,rep,name=env_vars,json=envVars,proto3" json:"env_vars,omitempty" protobuf_key:"bytes,1,opt,name=key,proto3" protobuf_val:"bytes,2,opt,name=value,proto3"`
	TtlSeconds int64             `protobuf:"varint,9,opt,name=ttl_seconds,json=ttlSeconds,proto3" json:"ttl_seconds,omitempty"`
}

func (x *CreateVMRequest) Reset() {
	*x = CreateVMRequest{}
}

func (x *CreateVMRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateVMRequest) ProtoMessage() {}

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

func (x *CreateVMRequest) GetVmId() string {
	if x != nil {
		return x.VmId
	}
	return ""
}

func (x *CreateVMRequest) GetUserId() string {
	if x != nil {
		return x.UserId
	}
	return ""
}

func (x *CreateVMRequest) GetImageUrl() string {
	if x != nil {
		return x.ImageUrl
	}
	return ""
}

func (x *CreateVMRequest) GetGitUrl() string {
	if x != nil {
		return x.GitUrl
	}
	return ""
}

func (x *CreateVMRequest) GetGitToken() string {
	if x != nil {
		return x.GitToken
	}
	return ""
}

func (x *CreateVMRequest) GetCores() int32 {
	if x != nil {
		return x.Cores
	}
	return 0
}

func (x *CreateVMRequest) GetMemory() int64 {
	if x != nil {
		return x.Memory
	}
	return 0
}

func (x *CreateVMRequest) GetEnvVars() map[string]string {
	if x != nil {
		return x.EnvVars
	}
	return nil
}

func (x *CreateVMRequest) GetTtlSeconds() int64 {
	if x != nil {
		return x.TtlSeconds
	}
	return 0
}

type CreateVMResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	VmId        string `protobuf:"bytes,1,opt,name=vm_id,json=vmId,proto3" json:"vm_id,omitempty"`
	ContainerId string `protobuf:"bytes,2,opt,name=container_id,json=containerId,proto3" json:"container_id,omitempty"`
	Success     bool   `protobuf:"varint,3,opt,name=success,proto3" json:"success,omitempty"`
	Message     string `protobuf:"bytes,4,opt,name=message,proto3" json:"message,omitempty"`
}

func (x *CreateVMResponse) Reset() {
	*x = CreateVMResponse{}
}

func (x *CreateVMResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateVMResponse) ProtoMessage() {}

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

func (x *CreateVMResponse) GetVmId() string {
	if x != nil {
		return x.VmId
	}
	return ""
}

func (x *CreateVMResponse) GetContainerId() string {
	if x != nil {
		return x.ContainerId
	}
	return ""
}

func (x *CreateVMResponse) GetSuccess() bool {
	if x != nil {
		return x.Success
	}
	return false
}

func (x *CreateVMResponse) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

type DeleteVMRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	VmId     string `protobuf:"bytes,1,opt,name=vm_id,json=vmId,proto3" json:"vm_id,omitempty"`
	RunnerId string `protobuf:"bytes,2,opt,name=runner_id,json=runnerId,proto3" json:"runner_id,omitempty"`
}

func (x *DeleteVMRequest) Reset() {
	*x = DeleteVMRequest{}
}

func (x *DeleteVMRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*DeleteVMRequest) ProtoMessage() {}

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

func (x *DeleteVMRequest) GetVmId() string {
	if x != nil {
		return x.VmId
	}
	return ""
}

func (x *DeleteVMRequest) GetRunnerId() string {
	if x != nil {
		return x.RunnerId
	}
	return ""
}

type DeleteVMResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Success bool   `protobuf:"varint,1,opt,name=success,proto3" json:"success,omitempty"`
	Message string `protobuf:"bytes,2,opt,name=message,proto3" json:"message,omitempty"`
}

func (x *DeleteVMResponse) Reset() {
	*x = DeleteVMResponse{}
}

func (x *DeleteVMResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*DeleteVMResponse) ProtoMessage() {}

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

func (x *DeleteVMResponse) GetSuccess() bool {
	if x != nil {
		return x.Success
	}
	return false
}

func (x *DeleteVMResponse) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

type VMInfo struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Id          string `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	ContainerId string `protobuf:"bytes,2,opt,name=container_id,json=containerId,proto3" json:"container_id,omitempty"`
	Status      string `protobuf:"bytes,3,opt,name=status,proto3" json:"status,omitempty"`
	CreatedAt   int64  `protobuf:"varint,4,opt,name=created_at,json=createdAt,proto3" json:"created_at,omitempty"`
}

func (x *VMInfo) Reset() {
	*x = VMInfo{}
}

func (x *VMInfo) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*VMInfo) ProtoMessage() {}

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

func (x *VMInfo) GetId() string {
	if x != nil {
		return x.Id
	}
	return ""
}

func (x *VMInfo) GetContainerId() string {
	if x != nil {
		return x.ContainerId
	}
	return ""
}

func (x *VMInfo) GetStatus() string {
	if x != nil {
		return x.Status
	}
	return ""
}

func (x *VMInfo) GetCreatedAt() int64 {
	if x != nil {
		return x.CreatedAt
	}
	return 0
}

type ListVMsRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	RunnerId string `protobuf:"bytes,1,opt,name=runner_id,json=runnerId,proto3" json:"runner_id,omitempty"`
}

func (x *ListVMsRequest) Reset() {
	*x = ListVMsRequest{}
}

func (x *ListVMsRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ListVMsRequest) ProtoMessage() {}

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

func (x *ListVMsRequest) GetRunnerId() string {
	if x != nil {
		return x.RunnerId
	}
	return ""
}

type ListVMsResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Vms []*VMInfo `protobuf:"bytes,1,rep,name=vms,proto3" json:"vms,omitempty"`
}

func (x *ListVMsResponse) Reset() {
	*x = ListVMsResponse{}
}

func (x *ListVMsResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ListVMsResponse) ProtoMessage() {}

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

func (x *ListVMsResponse) GetVms() []*VMInfo {
	if x != nil {
		return x.Vms
	}
	return nil
}

type GetVMInfoRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	VmId string `protobuf:"bytes,1,opt,name=vm_id,json=vmId,proto3" json:"vm_id,omitempty"`
}

func (x *GetVMInfoRequest) Reset() {
	*x = GetVMInfoRequest{}
}

func (x *GetVMInfoRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetVMInfoRequest) ProtoMessage() {}

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

func (x *GetVMInfoRequest) GetVmId() string {
	if x != nil {
		return x.VmId
	}
	return ""
}

type GetVMInfoResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Vm *VMInfo `protobuf:"bytes,1,opt,name=vm,proto3" json:"vm,omitempty"`
}

func (x *GetVMInfoResponse) Reset() {
	*x = GetVMInfoResponse{}
}

func (x *GetVMInfoResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*GetVMInfoResponse) ProtoMessage() {}

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

func (x *GetVMInfoResponse) GetVm() *VMInfo {
	if x != nil {
		return x.Vm
	}
	return nil
}

type CreateTaskRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	TaskId  string            `protobuf:"bytes,1,opt,name=task_id,json=taskId,proto3" json:"task_id,omitempty"`
	VmId    string            `protobuf:"bytes,2,opt,name=vm_id,json=vmId,proto3" json:"vm_id,omitempty"`
	Text    string            `protobuf:"bytes,3,opt,name=text,proto3" json:"text,omitempty"`
	Model   string            `protobuf:"bytes,4,opt,name=model,proto3" json:"model,omitempty"`
	ApiKey  string            `protobuf:"bytes,5,opt,name=api_key,json=apiKey,proto3" json:"api_key,omitempty"`
	BaseUrl string            `protobuf:"bytes,6,opt,name=base_url,json=baseUrl,proto3" json:"base_url,omitempty"`
	EnvVars map[string]string `protobuf:"bytes,7,rep,name=env_vars,json=envVars,proto3" json:"env_vars,omitempty" protobuf_key:"bytes,1,opt,name=key,proto3" protobuf_val:"bytes,2,opt,name=value,proto3"`
}

func (x *CreateTaskRequest) Reset() {
	*x = CreateTaskRequest{}
}

func (x *CreateTaskRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateTaskRequest) ProtoMessage() {}

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

func (x *CreateTaskRequest) GetTaskId() string {
	if x != nil {
		return x.TaskId
	}
	return ""
}

func (x *CreateTaskRequest) GetVmId() string {
	if x != nil {
		return x.VmId
	}
	return ""
}

func (x *CreateTaskRequest) GetText() string {
	if x != nil {
		return x.Text
	}
	return ""
}

func (x *CreateTaskRequest) GetModel() string {
	if x != nil {
		return x.Model
	}
	return ""
}

func (x *CreateTaskRequest) GetApiKey() string {
	if x != nil {
		return x.ApiKey
	}
	return ""
}

func (x *CreateTaskRequest) GetBaseUrl() string {
	if x != nil {
		return x.BaseUrl
	}
	return ""
}

func (x *CreateTaskRequest) GetEnvVars() map[string]string {
	if x != nil {
		return x.EnvVars
	}
	return nil
}

type CreateTaskResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Success bool   `protobuf:"varint,1,opt,name=success,proto3" json:"success,omitempty"`
	Message string `protobuf:"bytes,2,opt,name=message,proto3" json:"message,omitempty"`
}

func (x *CreateTaskResponse) Reset() {
	*x = CreateTaskResponse{}
}

func (x *CreateTaskResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*CreateTaskResponse) ProtoMessage() {}

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

func (x *CreateTaskResponse) GetSuccess() bool {
	if x != nil {
		return x.Success
	}
	return false
}

func (x *CreateTaskResponse) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

type StopTaskRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	TaskId string `protobuf:"bytes,1,opt,name=task_id,json=taskId,proto3" json:"task_id,omitempty"`
	VmId   string `protobuf:"bytes,2,opt,name=vm_id,json=vmId,proto3" json:"vm_id,omitempty"`
}

func (x *StopTaskRequest) Reset() {
	*x = StopTaskRequest{}
}

func (x *StopTaskRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*StopTaskRequest) ProtoMessage() {}

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

func (x *StopTaskRequest) GetTaskId() string {
	if x != nil {
		return x.TaskId
	}
	return ""
}

func (x *StopTaskRequest) GetVmId() string {
	if x != nil {
		return x.VmId
	}
	return ""
}

type StopTaskResponse struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Success bool   `protobuf:"varint,1,opt,name=success,proto3" json:"success,omitempty"`
	Message string `protobuf:"bytes,2,opt,name=message,proto3" json:"message,omitempty"`
}

func (x *StopTaskResponse) Reset() {
	*x = StopTaskResponse{}
}

func (x *StopTaskResponse) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*StopTaskResponse) ProtoMessage() {}

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

func (x *StopTaskResponse) GetSuccess() bool {
	if x != nil {
		return x.Success
	}
	return false
}

func (x *StopTaskResponse) GetMessage() string {
	if x != nil {
		return x.Message
	}
	return ""
}

type TerminalData struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	VmId       string          `protobuf:"bytes,1,opt,name=vm_id,json=vmId,proto3" json:"vm_id,omitempty"`
	TerminalId string          `protobuf:"bytes,2,opt,name=terminal_id,json=terminalId,proto3" json:"terminal_id,omitempty"`
	Data       []byte          `protobuf:"bytes,3,opt,name=data,proto3" json:"data,omitempty"`
	Resize     *TerminalResize `protobuf:"bytes,4,opt,name=resize,proto3" json:"resize,omitempty"`
}

func (x *TerminalData) Reset() {
	*x = TerminalData{}
}

func (x *TerminalData) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TerminalData) ProtoMessage() {}

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

func (x *TerminalData) GetVmId() string {
	if x != nil {
		return x.VmId
	}
	return ""
}

func (x *TerminalData) GetTerminalId() string {
	if x != nil {
		return x.TerminalId
	}
	return ""
}

func (x *TerminalData) GetData() []byte {
	if x != nil {
		return x.Data
	}
	return nil
}

func (x *TerminalData) GetResize() *TerminalResize {
	if x != nil {
		return x.Resize
	}
	return nil
}

type TerminalResize struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	Cols uint32 `protobuf:"varint,1,opt,name=cols,proto3" json:"cols,omitempty"`
	Rows uint32 `protobuf:"varint,2,opt,name=rows,proto3" json:"rows,omitempty"`
}

func (x *TerminalResize) Reset() {
	*x = TerminalResize{}
}

func (x *TerminalResize) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*TerminalResize) ProtoMessage() {}

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

func (x *TerminalResize) GetCols() uint32 {
	if x != nil {
		return x.Cols
	}
	return 0
}

func (x *TerminalResize) GetRows() uint32 {
	if x != nil {
		return x.Rows
	}
	return 0
}

type ReportRequest struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	TaskId string `protobuf:"bytes,1,opt,name=task_id,json=taskId,proto3" json:"task_id,omitempty"`
}

func (x *ReportRequest) Reset() {
	*x = ReportRequest{}
}

func (x *ReportRequest) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ReportRequest) ProtoMessage() {}

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

func (x *ReportRequest) GetTaskId() string {
	if x != nil {
		return x.TaskId
	}
	return ""
}

type ReportEntry struct {
	state         protoimpl.MessageState
	sizeCache     protoimpl.SizeCache
	unknownFields protoimpl.UnknownFields

	TaskId    string `protobuf:"bytes,1,opt,name=task_id,json=taskId,proto3" json:"task_id,omitempty"`
	Source    string `protobuf:"bytes,2,opt,name=source,proto3" json:"source,omitempty"`
	Timestamp int64  `protobuf:"varint,3,opt,name=timestamp,proto3" json:"timestamp,omitempty"`
	Data      []byte `protobuf:"bytes,4,opt,name=data,proto3" json:"data,omitempty"`
}

func (x *ReportEntry) Reset() {
	*x = ReportEntry{}
}

func (x *ReportEntry) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ReportEntry) ProtoMessage() {}

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

func (x *ReportEntry) GetTaskId() string {
	if x != nil {
		return x.TaskId
	}
	return ""
}

func (x *ReportEntry) GetSource() string {
	if x != nil {
		return x.Source
	}
	return ""
}

func (x *ReportEntry) GetTimestamp() int64 {
	if x != nil {
		return x.Timestamp
	}
	return 0
}

func (x *ReportEntry) GetData() []byte {
	if x != nil {
		return x.Data
	}
	return nil
}

var File_taskflow_proto protoreflect.FileDescriptor

var file_taskflow_proto_msgTypes = make([]protoimpl.MessageInfo, 21)
