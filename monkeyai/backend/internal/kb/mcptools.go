package kb

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"slices"
)

// MCPTools 返回知识库 MCP 暴露的工具目录，供 MCP 端点和 Agent 资源目录共同使用。
func MCPTools() []resource.Object {
	tools := []resource.Object{
		editMCPTool(), readMCPDocumentTool(),
		{
			"name":        "kb_upload_image",
			"description": "图片上传需求优先使用 REST POST /api/v1/kb/{id}/images/upload，以 multipart/form-data 的 file 字段由客户端直接上传文件。不要让大模型通过 tool calling 生成、复制或传递图片 Base64 来调用本工具。REST 需要 Agent 登录凭证，MCP Key 不能替代；缺少上传能力或登录凭证时，应提示使用客户端上传入口，不要回退为模型生成 Base64。本工具仅保留给可在模型上下文之外读取文件并程序化注入 Base64 的客户端。要求知识库启用且调用者有正文读写权限。data_base64 为标准 Base64（无 data URL 前缀），原图最多 32 MiB、2500 万像素，支持 PNG/JPEG/GIF/WebP。返回 name、url、mime_type、size_bytes、markdown；将 markdown 写入文档正文后通过文档工具保存，上传本身不修改文档。",
			"inputSchema": resource.Object{
				"type": "object",
				"properties": resource.Object{
					"kb_id":       resource.Object{"type": "string", "format": "uuid"},
					"data_base64": resource.Object{"type": "string", "minLength": 1, "maxLength": mcpImageBase64Limit, "description": "仅由客户端在模型上下文之外读取文件并程序化编码注入；禁止由模型生成或复制。标准 Base64，不包含 data URL 前缀；普通图片上传优先使用 REST multipart 接口"},
				},
				"required":             []string{"kb_id", "data_base64"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "kb_create",
			"description": "创建归当前调用者所有的个人知识库，返回知识库 id；可随后通过 kb_create_document 添加文档。不支持创建系统知识库或指定其他所有者。",
			"inputSchema": resource.Object{
				"type": "object",
				"properties": resource.Object{
					"name":        resource.Object{"type": "string", "minLength": 1, "description": "知识库名称，不超过 200 字节"},
					"description": resource.Object{"type": "string", "description": "知识库说明，可省略"},
				},
				"required":             []string{"name"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "kb_list",
			"description": "列出当前用户可访问且已启用的知识库，支持 owner、q、标签和分页，返回与 REST GET /api/v1/kb 一致的 knowledge_bases DTO",
			"inputSchema": resource.Object{
				"type": "object",
				"properties": resource.Object{
					"q":         resource.Object{"type": "string", "description": "按名称或描述做不区分大小写的包含匹配"},
					"owner":     resource.Object{"type": "string", "enum": []string{"all", "team", "mine", "shared"}, "default": "all", "description": "team 为系统知识库，mine 为本人创建，shared 为他人分享"},
					"tag_id":    resource.Object{"type": "string", "format": "uuid", "description": "按单个标签过滤，支持逗号分隔多个标签"},
					"tag_ids":   resource.Object{"type": "array", "items": resource.Object{"type": "string", "format": "uuid"}, "description": "按多个标签过滤"},
					"page":      resource.Object{"type": "integer", "minimum": 1, "maximum": documentMaxPage, "default": 1},
					"page_size": resource.Object{"type": "integer", "minimum": 1, "maximum": documentMaxPageSize, "default": documentDefaultPageSize},
				},
			},
		},
		{
			"name":        "kb_list_documents",
			"description": "分页列出当前用户有权限的知识库（系统或个人）下的文档元数据，可按标题或文件名搜索，并按学习状态和来源类型筛选；不返回正文，无权知识库返回 kb_not_found",
			"inputSchema": resource.Object{
				"type": "object",
				"properties": resource.Object{
					"kb_id":       resource.Object{"type": "string", "format": "uuid"},
					"q":           resource.Object{"type": "string", "description": "按文档标题或文件名做不区分大小写的包含匹配"},
					"status":      resource.Object{"type": "string", "enum": documentStatuses, "description": "文档学习状态"},
					"source_type": resource.Object{"type": "string", "enum": documentSourceTypes, "description": "文档来源类型"},
					"page":        resource.Object{"type": "integer", "minimum": 1, "maximum": documentMaxPage, "default": 1},
					"page_size":   resource.Object{"type": "integer", "minimum": 1, "maximum": documentMaxPageSize, "default": documentDefaultPageSize},
				},
				"required": []string{"kb_id"},
			},
		},
		{
			"name":        "kb_get_document",
			"description": "读取文档元数据和 revision；include_content=true 返回完整正文（兼容接口），长文档优先使用 kb_read_document 分段读取；无权文档返回 kb_not_found",
			"inputSchema": resource.Object{
				"type": "object",
				"properties": resource.Object{
					"kb_id":           resource.Object{"type": "string", "format": "uuid"},
					"document_id":     resource.Object{"type": "string", "format": "uuid"},
					"include_content": resource.Object{"type": "boolean", "default": false},
				},
				"required": []string{"kb_id", "document_id"},
			},
		},
		{
			"name":        "kb_create_folder",
			"description": "在启用且具有正文读写权限的知识库中创建文件夹。kb_id、title 必填，parent_id 可指定同库父文件夹，省略、null 或空字符串表示根目录。返回文件夹 id、parent_id、node_type 和 revision；文件夹不进入学习队列。",
			"inputSchema": mcpObjectSchema(resource.Object{
				"kb_id":     mcpIDSchema(),
				"title":     resource.Object{"type": "string", "minLength": 1},
				"parent_id": mcpCreateParentSchema(),
			}, "kb_id", "title"),
		},
		{
			"name":        "kb_create_document",
			"description": "仅当知识库为当前用户拥有或具有读写权限的知识库时创建文档，并进入学习队列。parent_id 可指定同库父文件夹，省略、null 或空字符串表示根目录。大文档创建不得让模型通过 tool calling 生成、复制或传递大段 content 参数；必须由客户端在模型上下文之外读取或准备完整正文，并程序化注入参数。缺少该能力时，应提示使用客户端文档上传或导入入口，不要回退为模型输出大段正文。请求仍受 1 MiB JSON body 上限约束，程序化注入不绕过该限制。",
			"inputSchema": resource.Object{
				"type":                 "object",
				"properties":           mcpCreateDocumentProperties(),
				"required":             []string{"kb_id", "title", "content"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "kb_update_document",
			"description": "更新文档元数据或整体替换正文；局部编辑优先使用 kb_edit_document，分段读取使用 kb_read_document。建议所有调用传 expected_revision；协作写入必须提供。仅正文改变时重新学习。content 省略或为空保持旧正文，删除文字请使用 kb_edit_document。大文档整体替换不得让模型通过 tool calling 生成、复制或传递大段 content 参数；必须由客户端在模型上下文之外读取或准备完整正文，并程序化注入参数。局部修改使用 kb_edit_document；确需整体替换但客户端缺少程序化注入能力时，应提示使用客户端文档编辑入口，不要回退为模型输出大段正文。请求仍受 1 MiB JSON body 上限约束，程序化注入不绕过该限制。",
			"inputSchema": resource.Object{
				"type":                 "object",
				"properties":           mcpUpdateDocumentProperties(),
				"required":             []string{"kb_id", "document_id"},
				"additionalProperties": false,
			},
		},
		{
			"name":        "kb_delete_document",
			"description": "删除知识库文档或文件夹并取消活跃学习任务；支持 ids 数组（最多 200 项），返回 succeeded/failed，协作调用提供 expected_revisions；兼容 document_id 和 expected_revision。只读用户不可写入。",
			"inputSchema": mcpDocumentOperationSchema(resource.Object{
				"kb_id": mcpIDSchema(), "document_id": mcpIDSchema(),
				"expected_revision":  resource.Object{"type": "integer", "minimum": 1},
				"expected_revisions": resource.Object{"type": "object", "additionalProperties": resource.Object{"type": "integer", "minimum": 1}},
			}),
		},
		{
			"name":        "kb_search",
			"description": "在可访问知识库中检索；绑定可用向量模型的知识库自动执行 lexical+vector 混合检索，否则仅执行 lexical。查找图片时传 file_types=[jpg,png]，query 使用具体画面对象或场景，如狗、草地；按画面描述判断匹配，不能把图片内文字提到狗等同于画面有狗。图片命中返回 image 元数据，用 kb_get_document_image 获取原图并在客户端展示，不能生成新图替代。top_k 仅为相关候选，不是全库完整清单。",
			"inputSchema": resource.Object{
				"type": "object",
				"properties": resource.Object{
					"file_types": resource.Object{"type": "array", "items": resource.Object{"type": "string", "enum": []string{"jpg", "png"}}, "description": "可选，仅检索指定图片格式；在召回前过滤"},
					"query":      resource.Object{"type": "string", "description": "检索问题"},
					"kb_ids":     resource.Object{"type": "array", "items": resource.Object{"type": "string", "format": "uuid"}},
					"top_k":      resource.Object{"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
					"filters":    resource.Object{"type": "object", "additionalProperties": true, "description": "兼容保留，目前不执行过滤并返回 filters_not_applied 警告；请勿传入，使用 kb_ids 限定检索范围"},
				},
				"required": []string{"query"},
			},
		},
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
		{"name": "kb_get_document_image", "description": "读取检索命中的独立图片文档原图。kb_id/document_id 来自 kb_search 的 image；按当前 MCP Key 检查阅读权限，返回 MCP image 内容块及元数据，客户端须支持图片展示。原图最多8 MiB可内联，超限须用已登录网页下载或预览；不要复制或生成 Base64，不接受任意URL。", "inputSchema": mcpObjectSchema(resource.Object{"kb_id": mcpIDSchema(), "document_id": mcpIDSchema()}, "kb_id", "document_id")},

		{
			"name":        "kb_get_image",
			"description": "读取知识库正文图片，要求当前用户对启用的知识库有阅读权限。name 使用 kb_upload_image 返回的名称或正文 assets URL 的最后一段；默认返回 MCP image 内容块与图片元数据；只需引用地址时传 include_data=false，避免传输图片数据。不接受任意 URL。",
			"inputSchema": mcpObjectSchema(resource.Object{
				"kb_id":        mcpIDSchema(),
				"name":         resource.Object{"type": "string", "pattern": assetName.String()},
				"include_data": resource.Object{"type": "boolean", "default": true},
			}, "kb_id", "name"),
		},
		{
			"name":        "kb_update",
			"description": "更新本人个人知识库信息；仅所有者可调用。先通过 kb_get 获取 revision，作为 expected_revision 传入，冲突时重新读取。各更新字段可选，省略保留原值；可修改 name、 description、tag_ids、fusion_config，avatar_base64 可替换图标（标准 Base64，无 data URL 前缀，原图最多 1 MiB，PNG/JPEG/WebP）。不支持修改所有者、授权、启用状态或向量模型绑定。",
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
			}, "kb_id", "expected_revision"),
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
	tools = append(tools, mcpFileTools()...)
	for _, tool := range tools {
		readOnly := slices.Contains([]string{"kb_list", "kb_get", "kb_list_tags", "kb_list_permissions", "kb_list_documents", "kb_get_document", "kb_read_document", "kb_get_image", "kb_get_document_image", "kb_search"}, tool.String("name"))
		tool["annotations"] = resource.Object{"readOnlyHint": readOnly, "destructiveHint": !readOnly, "idempotentHint": readOnly, "openWorldHint": false}
		if !readOnly {
			tool["description"] = tool.String("description") + " 写入超时或连接中断不代表失败，先读取核实结果，勿盲目重试；批量操作须逐项检查 failed，仅重试确认失败项。"
		}
	}
	return tools
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

func mcpDocumentProperties(includeKB bool) resource.Object {
	properties := resource.Object{
		"title":       resource.Object{"type": "string", "minLength": 1},
		"source_type": resource.Object{"type": "string", "enum": []string{"text", "file"}},
		"content":     resource.Object{"type": "string", "description": "文档正文。大文档必须由客户端在模型上下文之外读取或准备并程序化注入，禁止由模型生成、复制或传递大段正文参数；JSON 请求体上限为 1 MiB。局部修改优先使用 kb_edit_document"},
		"file_name":   resource.Object{"type": "string"},
		"mime_type":   resource.Object{"type": "string"},
		"size_bytes":  resource.Object{"type": "integer", "minimum": 0},
	}
	if includeKB {
		properties["kb_id"] = resource.Object{"type": "string", "format": "uuid"}
	}
	return properties
}

func mcpUpdateDocumentProperties() resource.Object {
	properties := mcpDocumentProperties(true)
	properties["document_id"] = resource.Object{"type": "string", "format": "uuid"}
	properties["expected_revision"] = resource.Object{"type": "integer", "minimum": 1}
	return properties
}

func editMCPTool() resource.Object {
	return resource.Object{
		"name":        "kb_edit_document",
		"description": "局部编辑文档正文的首选工具：先读取原文和 revision，再提交 edits；按顺序对前一步结果做唯一精确替换，不做模糊匹配。old_text 必须非空且恰好出现一次，new_text 可为空以删除文字。所有编辑在同一事务内执行，任一步失败整批不写入。所有者也必须提供 expected_revision；冲突需重新读取。成功仅返回元数据和新 revision，不回传全文。超时后先读取核实结果，不自动重试或重复应用。仅 file_type 为 txt/md/html/svg 的文档允许正文编辑；Office/PDF 派生正文、未知格式和文件夹不允许正文编辑。",
		"inputSchema": mcpObjectSchema(resource.Object{
			"kb_id": mcpIDSchema(), "document_id": mcpIDSchema(),
			"expected_revision": resource.Object{"type": "integer", "minimum": 1},
			"edits": resource.Object{"type": "array", "minItems": 1, "maxItems": maxMCPEdits, "items": mcpObjectSchema(resource.Object{
				"old_text": resource.Object{"type": "string", "minLength": 1}, "new_text": resource.Object{"type": "string"},
			}, "old_text", "new_text")},
		}, "kb_id", "document_id", "expected_revision", "edits"),
	}
}

func readMCPDocumentTool() resource.Object {
	return resource.Object{"name": "kb_read_document", "description": "按 Unicode 字符偏移分段读取原始正文，适合长文档编辑。返回 content、document（含 revision）、next_offset、has_more 和 total_characters。首次从 offset=0 读取；后续使用 next_offset 并提供首页 revision 作为 expected_revision，冲突时从头重新读取。索引分块不是原始正文，不应拿来整体覆盖文档。文件夹没有正文，不能读取。",
		"inputSchema": mcpObjectSchema(resource.Object{
			"kb_id": mcpIDSchema(), "document_id": mcpIDSchema(),
			"offset":            resource.Object{"type": "integer", "minimum": 0, "default": 0},
			"limit":             resource.Object{"type": "integer", "minimum": 1, "maximum": mcpTextPageMax, "default": mcpTextPageDefault},
			"expected_revision": resource.Object{"type": "integer", "minimum": 1},
		}, "kb_id", "document_id")}
}

func mcpCreateParentSchema() resource.Object {
	return resource.Object{
		"type":        []string{"string", "null"},
		"description": "同一知识库内的父文件夹 ID；省略、null 或空字符串表示根目录，可使用 kb_create_folder 返回的 id",
	}
}

func mcpCreateDocumentProperties() resource.Object {
	properties := mcpDocumentProperties(true)
	properties["source_type"] = resource.Object{"type": "string", "enum": []string{"text"}, "description": "仅支持创建文本正文；上传文件请使用网页或 REST 文件导入接口"}
	properties["parent_id"] = mcpCreateParentSchema()
	return properties
}

func mcpDocumentOperationSchema(properties resource.Object) resource.Object {
	properties["ids"] = resource.Object{"type": "array", "minItems": 1, "maxItems": maxBatchDocuments, "items": mcpIDSchema()}
	schema := mcpObjectSchema(properties, "kb_id")
	schema["oneOf"] = []any{
		resource.Object{"required": []string{"ids"}, "not": resource.Object{"required": []string{"document_id"}}},
		resource.Object{"required": []string{"document_id"}, "not": resource.Object{"required": []string{"ids"}}},
	}
	return schema
}
