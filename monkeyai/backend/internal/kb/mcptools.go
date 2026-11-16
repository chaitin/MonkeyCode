package kb

import "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

func additionalMCPTools() []resource.Object {
	return []resource.Object{
		{
			"name":        "kb_get",
			"description": "读取当前用户可访问且已启用的知识库详情、图标地址 avatar_path、有效权限和 revision；仅所有者的响应包含完整授权信息。",
			"inputSchema": mcpObjectSchema(resource.Object{"kb_id": mcpIDSchema()}, "kb_id"),
		},
		{
			"name":        "kb_list_tags",
			"description": "列出当前用户可访问且已启用的知识库所使用的标签，与 REST GET /api/v1/kb/tags 一致。",
			"inputSchema": mcpObjectSchema(resource.Object{}),
		},
		{
			"name":        "kb_list_permissions",
			"description": "读取本人个人知识库的完整授权列表和 revision；仅所有者可调用，内容读写成员不能查看完整授权。",
			"inputSchema": mcpObjectSchema(resource.Object{"kb_id": mcpIDSchema()}, "kb_id"),
		},
		{
			"name":        "kb_get_image",
			"description": "读取知识库正文图片，要求当前用户对启用的知识库有阅读权限。name 使用 kb_upload_image 返回的名称或正文 assets URL 的最后一段；返回 MCP image 内容块与图片元数据，不接受任意 URL。",
			"inputSchema": mcpObjectSchema(resource.Object{
				"kb_id": mcpIDSchema(),
				"name":  resource.Object{"type": "string", "pattern": assetName.String()},
			}, "kb_id", "name"),
		},
		{
			"name":        "kb_list_chunks",
			"description": "读取可访问文档的索引分块，返回 items（包括正文和分块元数据）；要求当前用户对启用的知识库有阅读权限，并校验文档属于指定知识库。",
			"inputSchema": mcpObjectSchema(resource.Object{"kb_id": mcpIDSchema(), "document_id": mcpIDSchema()}, "kb_id", "document_id"),
		},
		{
			"name":        "kb_update",
			"description": "更新本人个人知识库信息；仅所有者可调用。先通过 kb_get 获取 revision，作为 expected_revision 传入，冲突时重新读取。name 必填；可修改 description、tag_ids、fusion_config，avatar_base64 可替换图标（标准 Base64，无 data URL 前缀，原图最多 1 MiB，PNG/JPEG/WebP）。不支持修改所有者、授权、启用状态或向量模型绑定。",
			"inputSchema": mcpObjectSchema(resource.Object{
				"kb_id":             mcpIDSchema(),
				"expected_revision": resource.Object{"type": "integer", "minimum": 1},
				"name":              resource.Object{"type": "string", "minLength": 1, "description": "知识库名称，不超过 200 字节"},
				"description":       resource.Object{"type": "string"},
				"tag_ids":           resource.Object{"type": "array", "items": resource.Object{"type": "string", "format": "uuid"}},
				"fusion_config": resource.Object{
					"type": "object",
					"properties": resource.Object{
						"type": resource.Object{"type": "string", "enum": []string{"weighted_rrf"}},
						"k":    resource.Object{"type": "integer", "minimum": 1},
						"weights": resource.Object{
							"type": "object",
							"properties": resource.Object{
								"lexical": resource.Object{"type": "number", "minimum": 0},
								"vector":  resource.Object{"type": "number", "minimum": 0},
							},
							"additionalProperties": false,
						},
					},
					"additionalProperties": false,
				},
				"avatar_base64": resource.Object{"type": "string", "minLength": 1, "maxLength": (avatarUploadLimit + 2) / 3 * 4},
			}, "kb_id", "expected_revision", "name"),
		},
		{
			"name":        "kb_move_document",
			"description": "在知识库内移动文档或文件夹并调整排序，要求正文读写权限。parent_id 指定目标文件夹，省略或 null 表示根目录；prev_id、next_id 指定相邻节点。支持 ids 数组（最多 200 项），批量调用返回 succeeded/failed，协作调用提供 expected_revisions；兼容 document_id 和 expected_revision。本人个人库兼容无版本调用。禁止移动到自身或子目录。",
			"inputSchema": mcpDocumentOperationSchema(resource.Object{
				"kb_id":              mcpIDSchema(),
				"expected_revisions": resource.Object{"type": "object", "additionalProperties": resource.Object{"type": "integer", "minimum": 1}},
				"document_id":        mcpIDSchema(),
				"expected_revision":  resource.Object{"type": "integer", "minimum": 1},
				"parent_id":          resource.Object{"type": []string{"string", "null"}, "format": "uuid"},
				"prev_id":            resource.Object{"type": "string", "format": "uuid"},
				"next_id":            resource.Object{"type": "string", "format": "uuid"},
			}),
		},
		{
			"name":        "kb_restudy_document",
			"description": "重新学习指定知识库下的文档，与 REST POST /api/v1/kb/documents/restudy 一致；要求启用知识库的正文读写权限，取消旧活跃任务并按现有索引状态重建。支持 ids 数组（最多 200 项），返回 succeeded/failed；兼容 document_id。文件夹不能重新学习。",
			"inputSchema": mcpDocumentOperationSchema(resource.Object{"kb_id": mcpIDSchema(), "document_id": mcpIDSchema()}),
		},
	}
}

func mcpObjectSchema(properties resource.Object, required ...string) resource.Object {
	if required == nil {
		required = []string{}
	}
	return resource.Object{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
}

func mcpIDSchema() resource.Object {
	return resource.Object{"type": "string", "format": "uuid"}
}
