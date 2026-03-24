package domain

// FilePathReq 文件路径请求
type FilePathReq struct {
	ID   string `json:"id" query:"id" validate:"required"`     // 虚拟机 id
	Path string `json:"path" query:"path" validate:"required"` // 文件/目录路径
}

// FileChangeReq 文件变更请求（移动/复制）
type FileChangeReq struct {
	ID     string `json:"id" query:"id" validate:"required"`         // 虚拟机 id
	Source string `json:"source" query:"source" validate:"required"` // 来源
	Target string `json:"target" query:"target" validate:"required"` // 目标
}

// FileSaveReq 文件保存请求
type FileSaveReq struct {
	ID      string `json:"id" validate:"required"`   // 虚拟机 id
	Path    string `json:"path" validate:"required"` // 文件路径
	Content string `json:"content"`                  // 文件内容
}
