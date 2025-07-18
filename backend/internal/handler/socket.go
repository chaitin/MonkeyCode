package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/internal/service"
	socketio "github.com/doquangtan/socket.io/v4"
)

type FileUpdateData struct {
	ID           string `json:"id"`
	FilePath     string `json:"filePath"`
	Hash         string `json:"hash"`
	Event        string `json:"event"`
	Content      string `json:"content,omitempty"`
	PreviousHash string `json:"previousHash,omitempty"`
	Timestamp    int64  `json:"timestamp"`
}

type AckResponse struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type TestPingData struct {
	Timestamp int64  `json:"timestamp"`
	Message   string `json:"message"`
	SocketID  string `json:"socketId"`
}

type HeartbeatData struct {
	Type      string `json:"type"`
	Timestamp int64  `json:"timestamp"`
	ClientID  string `json:"clientId"`
}

type SocketHandler struct {
	config           *config.Config
	logger           *slog.Logger
	workspaceService *service.WorkspaceService
	io               *socketio.Io
	mu               sync.Mutex
}

func NewSocketHandler(config *config.Config, logger *slog.Logger, workspaceService *service.WorkspaceService) (*SocketHandler, error) {
	// 创建Socket.IO服务器
	io := socketio.New()

	handler := &SocketHandler{
		config:           config,
		logger:           logger,
		workspaceService: workspaceService,
		io:               io,
		mu:               sync.Mutex{}, // 初始化互斥锁
	}

	// 设置事件处理器
	handler.setupEventHandlers()

	return handler, nil
}

func (h *SocketHandler) setupEventHandlers() {
	h.io.OnConnection(h.handleConnection)
}

func (h *SocketHandler) handleConnection(socket *socketio.Socket) {
	h.logger.Info("Client connected", "socketId", socket.Id)
	h.sendServerStatus(socket, "ready", "Server is ready to receive updates")

	// 注册事件处理器
	h.registerDisconnectHandler(socket)
	h.registerFileUpdateHandler(socket)
	h.registerTestPingHandler(socket)
	h.registerHeartbeatHandler(socket)
	h.registerWorkspaceStatsHandler(socket)
}

func (h *SocketHandler) registerDisconnectHandler(socket *socketio.Socket) {
	socket.On("disconnect", func(data *socketio.EventPayload) {
		reason := "unknown"
		if len(data.Data) > 0 {
			if r, ok := data.Data[0].(string); ok {
				reason = r
			}
		}
		h.logger.Info("Client disconnected", "socketId", socket.Id, "reason", reason)
	})
}

func (h *SocketHandler) registerFileUpdateHandler(socket *socketio.Socket) {
	socket.On("file:update", func(data *socketio.EventPayload) {
		h.logger.Debug("Received file:update event",
			"socketId", socket.Id,
			"eventName", data.Name,
			"dataCount", len(data.Data),
			"hasAck", data.Ack != nil)

		if len(data.Data) == 0 {
			h.sendErrorACK(data, "No data provided")
			return
		}

		h.processFileUpdateData(socket, data)
	})
}

func (h *SocketHandler) processFileUpdateData(socket *socketio.Socket, data *socketio.EventPayload) {
	switch v := data.Data[0].(type) {
	case map[string]interface{}:
		response := h.handleFileUpdateFromObject(socket, *data)
		h.sendACKWithLock(data, response)
	case string:
		response := h.handleFileUpdate(socket, v)
		h.sendACKWithLock(data, response)
	default:
		h.logger.Error("Data is neither string nor object",
			"socketId", socket.Id,
			"dataType", fmt.Sprintf("%T", v))
		h.sendErrorACK(data, "Invalid data format - expected string or object")
	}
}

func (h *SocketHandler) registerTestPingHandler(socket *socketio.Socket) {
	socket.On("test:ping", func(data *socketio.EventPayload) {
		h.logger.Info("Received test:ping event",
			"socketId", socket.Id,
			"hasAck", data.Ack != nil,
			"dataCount", len(data.Data))

		if len(data.Data) > 0 {
			if dataStr, ok := data.Data[0].(string); ok {
				h.handleTestPing(socket, dataStr)
			}
		}
	})
}

func (h *SocketHandler) registerHeartbeatHandler(socket *socketio.Socket) {
	socket.On("heartbeat", func(data *socketio.EventPayload) {
		if len(data.Data) == 0 {
			h.sendErrorACK(data, "No heartbeat data")
			return
		}

		if dataStr, ok := data.Data[0].(string); ok {
			response := h.handleHeartbeat(socket, dataStr)
			h.logger.Debug("Sending heartbeat ACK",
				"socketId", socket.Id,
				"response", response)

			if data.Ack != nil {
				data.Ack(response)
			}
		}
	})
}

func (h *SocketHandler) registerWorkspaceStatsHandler(socket *socketio.Socket) {
	socket.On("workspace:stats", func(data *socketio.EventPayload) {
		h.logger.Info("Received workspace:stats event",
			"socketId", socket.Id,
			"hasAck", data.Ack != nil)

		response := h.handleWorkspaceStats(socket)
		h.logger.Info("Sending workspace stats ACK",
			"socketId", socket.Id,
			"response", response)

		if data.Ack != nil {
			data.Ack(response)
		}
	})
}

func (h *SocketHandler) handleFileUpdate(socket *socketio.Socket, data string) interface{} {
	var updateData FileUpdateData
	if err := json.Unmarshal([]byte(data), &updateData); err != nil {
		h.logger.Error("Failed to parse file update data", "error", err, "data", data)
		return map[string]interface{}{
			"status":  "error",
			"message": "Invalid data format",
		}
	}

	h.logger.Info("Processing file update",
		"socketId", socket.Id,
		"event", updateData.Event,
		"file", updateData.FilePath)

	// 立即返回确认收到
	immediateAck := AckResponse{
		ID:      updateData.ID,
		Status:  "received",
		Message: "File update received, processing...",
	}

	// 异步处理文件操作
	go h.processFileUpdateAsync(socket, updateData)

	return immediateAck
}

func (h *SocketHandler) handleFileUpdateFromObject(socket *socketio.Socket, data socketio.EventPayload) interface{} {
	// 从数据中获取第一个元素（应该是map）
	if len(data.Data) == 0 {
		h.logger.Error("No data provided for file update")
		return AckResponse{
			Status:  "error",
			Message: "No data provided",
		}
	}

	dataMap, ok := data.Data[0].(map[string]interface{})
	if !ok {
		h.logger.Error("Invalid data format for file update", "type", fmt.Sprintf("%T", data.Data[0]))
		return AckResponse{
			Status:  "error",
			Message: "Invalid data format",
		}
	}

	// 解析数据字段
	var updateData FileUpdateData

	// 使用类型断言提取字段
	if id, ok := dataMap["id"].(string); ok {
		updateData.ID = id
	}
	if filePath, ok := dataMap["filePath"].(string); ok {
		updateData.FilePath = filePath
	}
	if event, ok := dataMap["event"].(string); ok {
		updateData.Event = event
	}
	if hash, ok := dataMap["hash"].(string); ok {
		updateData.Hash = hash
	}
	if content, ok := dataMap["content"].(string); ok {
		updateData.Content = content
	}
	if timestamp, ok := dataMap["timestamp"].(float64); ok {
		updateData.Timestamp = int64(timestamp)
	}

	h.logger.Info("Processing file update",
		"socketId", socket.Id,
		"event", updateData.Event,
		"file", updateData.FilePath)

	// 立即返回确认收到
	immediateAck := AckResponse{
		ID:      updateData.ID,
		Status:  "received",
		Message: "File update received, processing...",
	}

	// 异步处理文件操作
	go h.processFileUpdateAsync(socket, updateData)

	return immediateAck
}

func (h *SocketHandler) processFileUpdateAsync(socket *socketio.Socket, updateData FileUpdateData) {
	// 处理文件操作
	var finalStatus, message string
	switch updateData.Event {
	case "initial_scan", "modified", "added":
		_, err := h.workspaceService.SaveFile(updateData.FilePath, updateData.Content)
		if err != nil {
			finalStatus = "error"
			message = fmt.Sprintf("Failed to save file: %v", err)
			h.logger.Error("Failed to save file", "path", updateData.FilePath, "error", err)
		} else {
			finalStatus = "success"
			message = "File saved successfully"
			h.logger.Info("File saved successfully", "path", updateData.FilePath)
		}

	case "deleted":
		err := h.workspaceService.DeleteFile(updateData.FilePath)
		if err != nil {
			finalStatus = "error"
			message = fmt.Sprintf("Failed to delete file: %v", err)
		} else {
			finalStatus = "success"
			message = "File deleted successfully"
		}

	default:
		finalStatus = "error"
		message = fmt.Sprintf("Unknown event type: %s", updateData.Event)
	}

	// 发送最终处理结果
	finalResponse := map[string]interface{}{
		"id":      updateData.ID,
		"status":  finalStatus,
		"message": message,
		"file":    updateData.FilePath,
	}

	h.logger.Debug("Sending final processing result",
		"socketId", socket.Id,
		"response", finalResponse)

	// 使用互斥锁保护Socket写入
	h.mu.Lock()
	socket.Emit("file:update:ack", finalResponse)
	h.mu.Unlock()
}

func (h *SocketHandler) handleTestPing(socket *socketio.Socket, data string) {
	var pingData TestPingData
	if err := json.Unmarshal([]byte(data), &pingData); err != nil {
		h.logger.Error("Failed to parse test ping data", "error", err)
		return
	}

	h.logger.Debug("Received test ping",
		"socketId", socket.Id,
		"message", pingData.Message)

	// 发送pong响应
	pongData := map[string]interface{}{
		"timestamp":    time.Now().UnixMilli(),
		"serverTime":   time.Now().Format(time.RFC3339),
		"message":      "Pong from MonkeyCode server",
		"receivedPing": pingData,
		"socketId":     socket.Id,
		"serverStatus": "ok",
	}

	h.mu.Lock()
	socket.Emit("test:pong", pongData)
	h.mu.Unlock()
}

func (h *SocketHandler) handleHeartbeat(socket *socketio.Socket, data string) interface{} {
	var heartbeatData HeartbeatData
	if err := json.Unmarshal([]byte(data), &heartbeatData); err != nil {
		h.logger.Error("Failed to parse heartbeat data", "error", err)
		return map[string]interface{}{
			"status":  "error",
			"message": "Invalid heartbeat data",
		}
	}

	// 记录心跳
	if h.config.Debug {
		h.logger.Debug("Heartbeat received", "socketId", socket.Id, "clientId", heartbeatData.ClientID)
	}

	// 返回心跳响应
	response := map[string]interface{}{
		"status":     "ok",
		"serverTime": time.Now().UnixMilli(),
		"socketId":   socket.Id,
	}

	return response
}

func (h *SocketHandler) handleWorkspaceStats(socket *socketio.Socket) interface{} {
	stats, err := h.workspaceService.GetWorkspaceStats()
	if err != nil {
		h.logger.Error("Failed to get workspace stats", "error", err)
		return map[string]interface{}{
			"error": "Failed to get workspace stats",
		}
	}

	h.logger.Debug("Workspace stats requested", "socketId", socket.Id)

	return stats
}

func (h *SocketHandler) sendServerStatus(socket *socketio.Socket, status, message string) {
	statusData := map[string]string{
		"status":  status,
		"message": message,
	}
	socket.Emit("server:status", statusData)
}

// GetServer 返回Socket.IO服务器实例
func (h *SocketHandler) GetServer() *socketio.Io {
	return h.io
}

// BroadcastServerStatus 向所有连接的客户端广播服务器状态
func (h *SocketHandler) BroadcastServerStatus(status, message string) {
	statusData := map[string]interface{}{
		"status":  status,
		"message": message,
	}
	h.io.Emit("server:status", statusData)
	h.logger.Debug("Broadcasted server status", "status", status, "message", message)
}

// GetConnectedClients 获取连接的客户端数量
func (h *SocketHandler) GetConnectedClients() int {
	sockets := h.io.Sockets()
	return len(sockets)
}

// 辅助方法：发送错误ACK
func (h *SocketHandler) sendErrorACK(data *socketio.EventPayload, message string) {
	if data.Ack != nil {
		errorResp := map[string]interface{}{
			"status":  "error",
			"message": message,
		}
		data.Ack(errorResp)
	}
}

// 辅助方法：带锁发送ACK
func (h *SocketHandler) sendACKWithLock(data *socketio.EventPayload, response interface{}) {
	if data.Ack != nil {
		h.mu.Lock()
		data.Ack(response)
		h.mu.Unlock()
	}
}
