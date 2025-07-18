package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// FileInfo 表示文件信息
type FileInfo struct {
	Path         string    `json:"path"`
	Hash         string    `json:"hash"`
	Size         int64     `json:"size"`
	ModTime      time.Time `json:"modTime"`
	Content      string    `json:"content,omitempty"`
	LastSyncTime time.Time `json:"lastSyncTime"`
}

// WorkspaceStats 表示工作区统计信息
type WorkspaceStats struct {
	TotalFiles int64     `json:"totalFiles"`
	TotalSize  int64     `json:"totalSize"`
	LastSync   time.Time `json:"lastSync"`
}

// WorkspaceService 提供文件工作区管理功能
type WorkspaceService struct {
	config     *config.Config
	logger     *slog.Logger
	fileCache  map[string]*FileInfo
	cacheMutex sync.RWMutex
}

// NewWorkspaceService 创建新的工作区服务实例
func NewWorkspaceService(config *config.Config, logger *slog.Logger) *WorkspaceService {
	// TODO: 实现持久化存储配置

	return &WorkspaceService{
		config:    config,
		logger:    logger,
		fileCache: make(map[string]*FileInfo),
	}
}

// SaveFile 保存文件内容到缓存
func (ws *WorkspaceService) SaveFile(filePath, content string) (*FileInfo, error) {
	ws.cacheMutex.Lock()
	defer ws.cacheMutex.Unlock()

	// TODO: 根据用户项目信息保存到数据库，用户权限验证、项目关联、文件版本管理

	fileInfo := ws.createFileInfo(filePath, content)
	ws.fileCache[filePath] = fileInfo

	ws.logFileOperation("saved", filePath, fileInfo.Hash, fileInfo.Size)
	return fileInfo, nil
}

// DeleteFile 从缓存中删除文件
func (ws *WorkspaceService) DeleteFile(filePath string) error {
	ws.cacheMutex.Lock()
	defer ws.cacheMutex.Unlock()

	// TODO: 根据用户项目信息从数据库删除，权限验证、软删除、操作日志

	delete(ws.fileCache, filePath)
	ws.logger.Info("File deleted successfully", "path", filePath)
	return nil
}

// GetFile 获取文件信息
func (ws *WorkspaceService) GetFile(filePath string) (*FileInfo, error) {
	ws.cacheMutex.RLock()
	defer ws.cacheMutex.RUnlock()

	// TODO: 根据用户项目信息从数据库查询

	fileInfo, exists := ws.fileCache[filePath]
	if !exists {
		return nil, fmt.Errorf("file not found: %s", filePath)
	}
	return fileInfo, nil
}

// ListFiles 返回所有缓存文件的信息
func (ws *WorkspaceService) ListFiles() ([]*FileInfo, error) {
	ws.cacheMutex.RLock()
	defer ws.cacheMutex.RUnlock()

	// TODO: 根据用户项目信息从数据库查询项目文件列表

	files := make([]*FileInfo, 0, len(ws.fileCache))
	for _, fileInfo := range ws.fileCache {
		files = append(files, fileInfo)
	}
	return files, nil
}

// GetWorkspaceStats 计算并返回工作区统计信息
func (ws *WorkspaceService) GetWorkspaceStats() (*WorkspaceStats, error) {
	ws.cacheMutex.RLock()
	defer ws.cacheMutex.RUnlock()

	stats := &WorkspaceStats{}

	for _, fileInfo := range ws.fileCache {
		stats.TotalFiles++
		stats.TotalSize += fileInfo.Size
		if fileInfo.LastSyncTime.After(stats.LastSync) {
			stats.LastSync = fileInfo.LastSyncTime
		}
	}

	return stats, nil
}

// VerifyFileHash 验证文件哈希值是否匹配
func (ws *WorkspaceService) VerifyFileHash(filePath, expectedHash string) (bool, error) {
	// TODO: 数据库验证文件哈希

	fileInfo, err := ws.GetFile(filePath)
	if err != nil {
		return false, err
	}
	return fileInfo.Hash == expectedHash, nil
}

// ClearCache 清空所有文件缓存
func (ws *WorkspaceService) ClearCache() {
	ws.cacheMutex.Lock()
	defer ws.cacheMutex.Unlock()

	ws.fileCache = make(map[string]*FileInfo)
	ws.logger.Info("File cache cleared")
}

// createFileInfo 创建文件信息对象
func (ws *WorkspaceService) createFileInfo(filePath, content string) *FileInfo {
	now := time.Now()
	return &FileInfo{
		Path:         filePath,
		Hash:         ws.calculateHash(content),
		Size:         int64(len(content)),
		ModTime:      now,
		Content:      content,
		LastSyncTime: now,
	}
}

// logFileOperation 记录文件操作日志
func (ws *WorkspaceService) logFileOperation(operation, path, hash string, size int64) {
	ws.logger.Info("File "+operation+" successfully",
		"path", path,
		"hash", hash,
		"size", size)
}

// calculateHash 计算文件内容的 SHA-256 哈希值
func (ws *WorkspaceService) calculateHash(content string) string {
	hash := sha256.Sum256([]byte(content))
	return hex.EncodeToString(hash[:])
}
