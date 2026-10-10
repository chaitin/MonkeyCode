# 视频模型抽象 Schema（设计稿）

> 状态：首期后端、管理后台配置与 Agent API 已在 `feat-video-generation` 工作区实现；数据库迁移和真实供应商端到端调用仍待实际环境验证。
>
> 参照：[生图模型接入设计](image-generation-design.md)、当前 `backend/internal/model` 与 `backend/internal/imagegen`。下文示例是设计数据，不代表所举供应商已接入。

## 1. 设计边界

视频模型仍是 `Model` 资源，复用所有权、授权、标签、凭据与 `model_id@id`。新增 `kind=video`、`protocol=video_generation`；视频不能伪装成文本 Token 或图片生成调用。首期分开表达：**可选参数及参数之间的约束**、**各模式的基本参考输入**、**按清晰度和生成秒数计价**。参考之间、参考与参数之间的条件约束不进入首期；不能假设所有供应商都能接入这一受限抽象。

管理员选择开放范围与积分费率；适配器代码声明上游能力并负责映射原生参数。客户端只看到二者的有效交集，不接收供应商原生 URL、密钥或可任意透传的参数。以下 Go 类型用于说明 JSON 契约；以实际后端字段和校验为准。

## 2. 参数与条件

```go
const (
    KindVideo     Kind     = "video"
    ProtocolVideo Protocol = "video_generation"
)

// 固定输入形态由模式区分；不靠参考素材条件动态切换上游调用。
type VideoMode string // text_to_video, image_to_video, last_frame_to_video, first_last_to_video, reference_image_to_video

type VideoParamSpec struct {
    Name          string            `json:"name"`
    Type          string            `json:"type"` // string, integer, boolean
    Choices       []json.RawMessage `json:"choices,omitempty"`
    Min           *int64            `json:"min,omitempty"`
    Max           *int64            `json:"max,omitempty"`
    Step          *int64            `json:"step,omitempty"`
    Default       json.RawMessage   `json:"default,omitempty"`
    AvailableWhen []VideoCondition  `json:"available_when,omitempty"`
    RequiredWhen  []VideoCondition  `json:"required_when,omitempty"`
}

// 仅用于模式与已声明参数；同一个条件内为 AND，多个条件为 OR。
type VideoCondition struct {
    Modes       []VideoMode                `json:"modes,omitempty"`
    ParamEquals map[string]json.RawMessage `json:"param_equals,omitempty"`
}

// 命中条件后收窄参数；多条命中的规则求交，不做优先级覆盖。
type VideoParamRule struct {
    When    VideoCondition    `json:"when"`
    Name    string            `json:"name"`
    Choices []json.RawMessage `json:"choices,omitempty"`
    Min     *int64            `json:"min,omitempty"`
    Max     *int64            `json:"max,omitempty"`
    Step    *int64            `json:"step,omitempty"`
}
```

`resolution`、`aspect_ratio`、`duration_seconds` 等常用键也作为强类型参数定义：分辨率是供应商声明的输出档位（如 xAI 的 `720p` 与 MiniMax 的 `768P`，大小写及像素语义不做统一映射）；时长既可以为离散选项，也可以是有界步进整数；不能用浮点数传秒。其他参数如帧率、音频开关、Seed、运镜强度等须由适配器**逐个声明**类型、可选值/上下界及默认值，再由服务端校验和映射；未知字段一律拒绝，不透传上游。不得推定所有模式共享相同参数范围。

`AvailableWhen`/`RequiredWhen` 为空分别表示总是可用/始终非必填。只对已归一化的模式与默认参数求值；`ParamEquals` 只允许引用已声明的离散参数，条件不得构成循环依赖。参数规则可表达“仅在 720p 支持 10 秒”“启用音频后最高 8 秒”；交集为空或默认值不合法时拒绝保存/调用，而不是默默更换请求。首期不允许条件引用参考角色、数量或素材元数据；无法仅凭参数规则表达的供应商能力不开放为对应模式。

## 3. 参考素材：按模式声明基本输入

```go
type VideoReferenceSpec struct {
    Role           string   `json:"role"` // first_frame, last_frame, reference_image
    MediaType      string   `json:"media_type"` // 首期仅 image
    MaxCount       uint32   `json:"max_count"`
    MIME           []string `json:"mime"`
    MaxBytes       uint64   `json:"max_bytes"`
    MinWidth       uint32   `json:"min_width,omitempty"`
    MaxWidth       uint32   `json:"max_width,omitempty"`
    MinHeight      uint32   `json:"min_height,omitempty"`
    MaxHeight      uint32   `json:"max_height,omitempty"`
    MinAspectRatio string   `json:"min_aspect_ratio,omitempty"`
    MaxAspectRatio string   `json:"max_aspect_ratio,omitempty"`
}

type VideoModeReferences struct {
    Mode          VideoMode `json:"mode"`
    RequiredRoles []string  `json:"required_roles"`
    OptionalRoles []string  `json:"optional_roles"`
}

type VideoReference struct {
    Role   string `json:"role"`
    FileID string `json:"file_id"`
}

type VideoCapabilities struct {
    Modes               []VideoMode          `json:"modes"`
    Params              []VideoParamSpec     `json:"params"`
    ParamRules          []VideoParamRule     `json:"param_rules,omitempty"`
    References          []VideoReferenceSpec `json:"references"`
    ReferenceModes      []VideoModeReferences `json:"reference_modes"`
    PromptMaxCharacters uint32               `json:"prompt_max_characters"`
    PromptRequiredWhen  []VideoCondition     `json:"prompt_required_when,omitempty"`
}
```

每个已开放模式恰有一条 `reference_modes`：文生视频不接收参考，首帧图生视频只接收首帧，尾帧图生视频只接收尾帧，首尾帧模式要求两张图片，参考图模式只接收参考图片。每个角色须有唯一的 `VideoReferenceSpec`；请求中不得出现该模式未声明的角色，必填角色须至少有一项，同一角色不得超过 `max_count`。各角色仍须检查真实 MIME、大小、宽高及比例；`min_aspect_ratio`/`max_aspect_ratio` 是图片宽÷高的十进制边界，而非输出比例选项。这些是基本输入定义和文件安全边界，并非可编辑的条件规则。

首期**不支持**“有某参考才允许另一参考”“某参考仅在特定清晰度可用”、参考之间互斥或参考内容决定参数范围。通过首帧、尾帧、首尾帧等**独立模式**表达固定输入形态；各模式允许的清晰度、比例与时长由参数规则限定。若上游存在跨参考类型或文件内容的限制，无法准确表达时不开放该模式，不能把非法请求直接转发上游，也不能用不可见的适配器规则让目录声明的组合看似可用。

基本参考示例（仅示意角色结构，具体数量和素材格式以供应商与平台限制交集为准）：

```json
{
  "references": [
    {"role": "first_frame", "media_type": "image", "max_count": 1, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760},
    {"role": "last_frame", "media_type": "image", "max_count": 1, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760},
    {"role": "reference_image", "media_type": "image", "max_count": 7, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760}
  ],
  "reference_modes": [
    {"mode": "text_to_video", "required_roles": [], "optional_roles": []},
    {"mode": "image_to_video", "required_roles": ["first_frame"], "optional_roles": []},
    {"mode": "last_frame_to_video", "required_roles": ["last_frame"], "optional_roles": []},
    {"mode": "first_last_to_video", "required_roles": ["first_frame", "last_frame"], "optional_roles": []},
    {"mode": "reference_image_to_video", "required_roles": ["reference_image"], "optional_roles": []}
  ]
}
```

必须通过 `file_id` 引用已上传图片；服务端先校验调用用户所有权、有效期、真实媒体属性、文件大小与像素限制，才允许读取或向上游发送。不能接受客户端指定的远程 URL 或绕过文件校验。首期不接受输入视频、音频；输入图片数量不进入用户积分定价。

## 4. 管理配置、目录与调用

```go
// 管理员只收窄适配器给出的能力，不编辑原生参数映射或参考校验代码。
type VideoParamLimit struct {
    Choices []json.RawMessage `json:"choices,omitempty"`
    Min     *int64            `json:"min,omitempty"`
    Max     *int64            `json:"max,omitempty"`
    Step    *int64            `json:"step,omitempty"`
}

type VideoConfig struct {
    Modes    []VideoMode                             `json:"modes"`
    Limits   map[VideoMode]map[string]VideoParamLimit `json:"limits,omitempty"`
    Defaults map[VideoMode]map[string]json.RawMessage `json:"defaults"`
}

type AgentVideoConfig struct {
    VideoConfig
    Params              []VideoParamSpec     `json:"params"`
    ParamRules          []VideoParamRule     `json:"param_rules,omitempty"`
    References          []VideoReferenceSpec `json:"references"`
    ReferenceModes      []VideoModeReferences `json:"reference_modes"`
    PromptMaxCharacters uint32               `json:"prompt_max_characters"`
    PromptRequiredWhen  []VideoCondition     `json:"prompt_required_when,omitempty"`
}

type VideoGenerateInput struct {
    Model          string                     `json:"model"`
    Mode           VideoMode                  `json:"mode"`
    Prompt         string                     `json:"prompt"`
    Params         map[string]json.RawMessage `json:"params"`
    References     []VideoReference           `json:"references,omitempty"`
    IdempotencyKey string                     `json:"-"` // 从 Idempotency-Key 请求头读取
}
```

`Model`/管理员保存 DTO 增加 `video_config`、`video_pricing`；个人保存 DTO 不接收定价，服务端按现有个人生图模型策略设置零积分价格。`AgentModel` 下发合成后的 `AgentVideoConfig` 与公开的每秒积分费率，不下发 Provider、BaseURL、凭据、原生尺寸映射或内部下载地址。管理员开放的模式、可选值、整数上下界/步进与默认值都必须是适配器当前能力的合法子集；能力升级致配置失效时拒绝调用并要求调整。

请求先验证模式和提示词，再补齐该模式的默认参数并计算参数条件，然后检查该模式的必填/可选参考角色与文件属性，最后计算报价。`prompt` 是否必填由 `prompt_required_when` 对该模式求值决定，不能在所有图片/视频/音频输入场景下一刀切；未声明的角色、参数或价目禁止调用。条件的求值顺序与默认值应用顺序固定，避免请求与目录产生不同结果。

### 两个目标型号的首期能力

根据 [xAI 视频能力与模式](https://docs.x.ai/developers/model-capabilities/video/overview)、[xAI 图生视频](https://docs.x.ai/developers/model-capabilities/video/image-to-video)、[xAI 参考生成](https://docs.x.ai/developers/model-capabilities/video/reference-to-video) 和 [MiniMax-H3 视频生成 API](https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md) 核对；这里只列首期**可由固定模式准确表达**的子集，不声明上游其他功能不存在。

| 型号 | 首期模式 | 输出清晰度 | 时长 | 比例与提示词 |
| --- | --- | --- | --- | --- |
| `grok-imagine-video-1.5` | 文生、单首帧图生、纯参考图 | `480p`、`720p`、`1080p`；纯参考图最高 `720p` | 1–15 秒 | 文生可选固定比例，单首帧图生跟随输入图；图生提示词可选 |
| `MiniMax-H3` | 文生、单首帧、单尾帧、首尾帧、纯参考图 | `768P`、`2K` | 4–15 秒（整数） | 文生必须指定固定比例，首/尾帧使用 `adaptive`；所有模式提示词必填 |

Grok 纯参考图最多开放 7 张：其[参考生成专页](https://docs.x.ai/developers/model-capabilities/video/reference-to-video)写 7 张，[概览页](https://docs.x.ai/developers/model-capabilities/video/overview)写 14 张，正式接入前须再核对实际接口；这里暂用更保守的 7 张。MiniMax-H3 纯参考图最多 9 张。Grok 的尾帧/关键帧/预置声音、多参考组合，以及 MiniMax-H3 的混合图片/视频/音频参考和视频重制不在首期目录中；这些模式涉及额外输入组合和素材总量规则，不应借口“适配器会处理”而开放虚假的可用组合。

以下是两条 `AgentModel` 的视频相关字段**示意**；实际目录还包含现有的 `id`、所有权、标签等字段。积分费率为管理员示例值，**不是**供应商美元价；`max_bytes`、`prompt_max_characters` 是平台示例上限，不代表官方限额。

```json
{
  "model": "grok-imagine-video-1.5@model-id",
  "kind": "video",
  "protocol": "video_generation",
  "video_config": {
    "modes": ["text_to_video", "image_to_video", "reference_image_to_video"],
    "defaults": {
      "text_to_video": {"resolution": "720p", "aspect_ratio": "16:9", "duration_seconds": 6},
      "image_to_video": {"resolution": "720p", "aspect_ratio": "adaptive", "duration_seconds": 6},
      "reference_image_to_video": {"resolution": "720p", "aspect_ratio": "16:9", "duration_seconds": 6}
    },
    "params": [
      {"name": "resolution", "type": "string", "choices": ["480p", "720p", "1080p"]},
      {"name": "aspect_ratio", "type": "string", "choices": ["adaptive", "16:9", "9:16"]},
      {"name": "duration_seconds", "type": "integer", "min": 1, "max": 15, "step": 1}
    ],
    "param_rules": [
      {"when": {"modes": ["text_to_video", "reference_image_to_video"]}, "name": "aspect_ratio", "choices": ["16:9", "9:16"]},
      {"when": {"modes": ["image_to_video"]}, "name": "aspect_ratio", "choices": ["adaptive"]},
      {"when": {"modes": ["reference_image_to_video"]}, "name": "resolution", "choices": ["480p", "720p"]}
    ],
    "references": [
      {"role": "first_frame", "media_type": "image", "max_count": 1, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760},
      {"role": "reference_image", "media_type": "image", "max_count": 7, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760}
    ],
    "reference_modes": [
      {"mode": "text_to_video", "required_roles": [], "optional_roles": []},
      {"mode": "image_to_video", "required_roles": ["first_frame"], "optional_roles": []},
      {"mode": "reference_image_to_video", "required_roles": ["reference_image"], "optional_roles": []}
    ],
    "prompt_max_characters": 2000,
    "prompt_required_when": [{"modes": ["text_to_video", "reference_image_to_video"]}]
  },
  "video_pricing": {
    "rates": [
      {"resolution": "480p", "credits_per_second": "8"},
      {"resolution": "720p", "credits_per_second": "14"},
      {"resolution": "1080p", "credits_per_second": "25"}
    ]
  }
}
```

```json
{
  "model": "MiniMax-H3@model-id",
  "kind": "video",
  "protocol": "video_generation",
  "video_config": {
    "modes": ["text_to_video", "image_to_video", "last_frame_to_video", "first_last_to_video", "reference_image_to_video"],
    "defaults": {
      "text_to_video": {"resolution": "768P", "aspect_ratio": "16:9", "duration_seconds": 5},
      "image_to_video": {"resolution": "768P", "aspect_ratio": "adaptive", "duration_seconds": 5},
      "last_frame_to_video": {"resolution": "768P", "aspect_ratio": "adaptive", "duration_seconds": 5},
      "first_last_to_video": {"resolution": "768P", "aspect_ratio": "adaptive", "duration_seconds": 5},
      "reference_image_to_video": {"resolution": "768P", "aspect_ratio": "adaptive", "duration_seconds": 5}
    },
    "params": [
      {"name": "resolution", "type": "string", "choices": ["768P", "2K"]},
      {"name": "aspect_ratio", "type": "string", "choices": ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]},
      {"name": "duration_seconds", "type": "integer", "min": 4, "max": 15, "step": 1}
    ],
    "param_rules": [
      {"when": {"modes": ["text_to_video"]}, "name": "aspect_ratio", "choices": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]},
      {"when": {"modes": ["image_to_video", "last_frame_to_video", "first_last_to_video"]}, "name": "aspect_ratio", "choices": ["adaptive"]}
    ],
    "references": [
      {"role": "first_frame", "media_type": "image", "max_count": 1, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760, "min_width": 256, "max_width": 5760, "min_height": 256, "max_height": 5760, "min_aspect_ratio": "0.4", "max_aspect_ratio": "2.5"},
      {"role": "last_frame", "media_type": "image", "max_count": 1, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760, "min_width": 256, "max_width": 5760, "min_height": 256, "max_height": 5760, "min_aspect_ratio": "0.4", "max_aspect_ratio": "2.5"},
      {"role": "reference_image", "media_type": "image", "max_count": 9, "mime": ["image/png", "image/jpeg"], "max_bytes": 10485760, "min_width": 256, "max_width": 5760, "min_height": 256, "max_height": 5760}
    ],
    "reference_modes": [
      {"mode": "text_to_video", "required_roles": [], "optional_roles": []},
      {"mode": "image_to_video", "required_roles": ["first_frame"], "optional_roles": []},
      {"mode": "last_frame_to_video", "required_roles": ["last_frame"], "optional_roles": []},
      {"mode": "first_last_to_video", "required_roles": ["first_frame", "last_frame"], "optional_roles": []},
      {"mode": "reference_image_to_video", "required_roles": ["reference_image"], "optional_roles": []}
    ],
    "prompt_max_characters": 2000,
    "prompt_required_when": [{"modes": ["text_to_video", "image_to_video", "last_frame_to_video", "first_last_to_video", "reference_image_to_video"]}]
  },
  "video_pricing": {
    "rates": [
      {"resolution": "768P", "credits_per_second": "10"},
      {"resolution": "2K", "credits_per_second": "20"}
    ]
  }
}
```

在 `image_to_video` 下，Agent 用 `aspect_ratio="adaptive"` 表示“跟随输入图”；xAI 适配器不发送会被忽略的比例字段，MiniMax 适配器发送 `ratio="adaptive"`。Agent 的生成请求只使用平台的 `mode`、`params` 和受权限保护的 `references[].file_id`，不暴露 xAI 的 `image`/`reference_images` 或 MiniMax 的 `content[]` 等原生结构。目录仅供展示和预校验；服务端仍须校验实时能力、文件所有权与计费。以上是目录**实例**，不是通用 JSON Schema 标准文档。

## 5. 积分定价：清晰度 × 输出秒数

```go
type VideoResolutionRate struct {
    Resolution       string `json:"resolution"`
    CreditsPerSecond string `json:"credits_per_second"`
}

type VideoPricing struct {
    Rates []VideoResolutionRate `json:"rates"`
}
```

清晰度使用各模型已公布的 `resolution` 档位（Grok 的 `720p` 与 MiniMax 的 `2K` 属于**不同模型**），每个模型的每个开放档位配置且只配置一条非负十进制积分费率。**一次成功视频的积分 = 该清晰度的每秒积分 × 实际输出时长（毫秒 ÷ 1000）**，按现有定点金额精度结算，不经过 `float64`；时长统一按毫秒精确计量，不向上按整秒取整。模式、比例与参考图片数量只决定能力与输入校验，不参与积分价格，也不产生额外计费项。同一清晰度无论是文生视频还是图生视频，都使用相同费率；若某供应商产品必须区分输入收费，留待后续扩展，不在当前积分 schema 中伪装成清晰度费率。

例如上面的 Grok 示例中，720p 成片实际为 6 秒，积分为 `14 × 6 = 84`；无论传入多少有效参考图片，用户积分仍为 84。目录公开每个清晰度的每秒积分，客户端可按请求时长估算价格。截图中的输入图片、输入视频收费不纳入本期用户积分定价；截图中的美元也不能直接当作积分。

受理任务时先按所选清晰度费率及适配器可证明的最大输出时长预留积分，并固化费率快照；若输出时长无法界定上限，则不能接受请求。成功归档后按实际输出毫秒时长结算并释放多余预留；超出预留上限或能力范围的输出不能透支扣费或静默交付。明确失败释放预留；上游已受理但结果不确定时标为 `unknown`，既不自动重新提交也不当作免费。个人模型仍记录用量，费率快照为零。

## 6. 任务与持久化边界

统一为本地异步任务（同步供应商也归一为完成任务），包含 `created`、`reserved`、`submitted`、`running`、`succeeded`、`failed`、`unknown` 状态。任务保存用户/模型、标准化参数、素材文件 ID 与用于校验的素材元数据、能力版本、Provider 作业 ID、价格快照及状态。用户与幂等键相同且请求内容相同时仅返回原任务，键相同内容不同则拒绝；任务查询须核对所有权。成功输出保存 MIME、宽高、实际毫秒时长、字节数及受权限保护的文件 ID；不得直接向客户端暴露上游临时 URL。上游输出必须经受限下载、解码校验和归档后才算成功；超出预留上限或与所选能力不符的输出不能静默交付或透支扣费。

实现采用独立视频任务/输出记录、受所有权约束的输入文件、`models` 视频字段及 kind/protocol 互斥约束、视频计费分类与过期对象清理，不复用图片任务表。

## 7. Agent 视频生成 API

### 7.1 路由与鉴权

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/v1/videos/inputs` | 上传一张参考图片，返回当前用户专属 `file_id` |
| `POST` | `/v1/videos/generations` | 验证并受理一次视频生成，返回本地异步任务 |
| `GET` | `/v1/videos/tasks/{id}` | 查询本地任务、输出元数据及最终积分 |
| `GET` | `/v1/videos/outputs/{id}` | 下载归档的视频文件，支持单段字节范围请求 |

与现有 `/v1/images` 同为原生异步接口：`X-Api-Key` 优先，`Authorization: Bearer <API Key>` 兜底；每个路由均要求 `model:invoke` scope。生成时还须通过模型授权及 `video_generation` 协议检查；上传、任务查询和输出下载均按**调用用户**隔离，不以能否继续访问原模型决定历史任务的可读性。可选会话头沿用 `X-MAI-Session-ID`（兼容 `X-Session-ID`）及 `X-MAI-Parent-Session-ID`。返回的任务 ID 与文件 ID 均是平台本地 ID，不是供应商 ID。

`/v1/videos/inputs` 是新设计的独立资源端点，不能直接把现有 `/v1/images/inputs` 的图片任务生命周期当作视频输入持有机制；若将来共用底层文件存储，仍须保证跨任务所有权及任务处理期间的保留期。首期每次上传仅一张不超过 10 MiB 的 JPEG/PNG 图片，不支持远程 URL、Base64 或输入视频/音频。请求为 `multipart/form-data`，字段名 `file`；上传阶段做有界读取与解码、真实格式/像素校验，生成阶段再按所选模型和参考角色校验尺寸、数量与有效期。超出所选模型限制时拒绝生成，不因上传成功而承诺所有模型都接受该图片。

成功上传返回 `201 Created`：

```json
{
  "file_id": "input-file-id",
  "mime_type": "image/png",
  "width": 1280,
  "height": 720,
  "expires_at": "2026-10-10T12:00:00Z"
}
```

### 7.2 创建生成任务

`POST /v1/videos/generations` 只接受一个 `application/json` 对象，未知字段、非法模式/参数、未声明的参考角色均返回错误。`model` 与 `mode` 必填；`prompt` 按模型的 `prompt_required_when` 校验；`params` 可省略部分字段，由该模式的 `defaults` 补齐；`references` 不传视为空列表。首期一次只产出一个视频，不接受 `count`、供应商原生参数、源视频编辑或输出格式指定。

可选请求头 `Idempotency-Key`（最多 128 字符），不接受 body 中的 `idempotency_key`。例如 Grok 单首帧图生视频：

```http
POST /v1/videos/generations HTTP/1.1
X-Api-Key: <API Key>
Idempotency-Key: video-request-001
Content-Type: application/json
```

```json
{
  "model": "grok-imagine-video-1.5@model-id",
  "mode": "image_to_video",
  "prompt": "海边日落，镜头缓慢推进",
  "params": {"resolution": "720p", "aspect_ratio": "adaptive", "duration_seconds": 6},
  "references": [{"role": "first_frame", "file_id": "input-file-id"}]
}
```

MiniMax-H3 首尾帧使用同一路由，只换模型、模式、参数和参考：

```json
{
  "model": "MiniMax-H3@model-id",
  "mode": "first_last_to_video",
  "prompt": "镜头平滑地从首帧过渡到尾帧",
  "params": {"resolution": "2K", "aspect_ratio": "adaptive", "duration_seconds": 5},
  "references": [
    {"role": "first_frame", "file_id": "first-image-id"},
    {"role": "last_frame", "file_id": "last-image-id"}
  ]
}
```

受理流程：鉴权并解析模型 → 应用默认参数 → 按模式验证提示词、参数与文件归属/基本输入 → 固化标准化请求和费率快照 → 在持久化本地任务及预留积分后派发上游调用。若鉴权、校验或预留失败，不应向上游提交请求。客户端断连不取消已经受理的任务。相同用户和幂等键对**同一标准化请求**（包含模型、模式、参数、提示词、按顺序排列的文件 ID 及会话）返回原任务，不再预留或提交；同键不同请求返回 `409`。重复请求无论任务是否已完成，仍以 `202 Accepted` 返回当前任务快照。数据库需原子确保用户和幂等键唯一，防止并发双扣费。

受理成功返回 `202 Accepted`，响应头 `Location: /v1/videos/tasks/{id}`；`created/reserved/submitted` 等内部态对外统一为 `pending`：

```json
{
  "id": "video-task-id",
  "model": "grok-imagine-video-1.5@model-id",
  "mode": "image_to_video",
  "status": "pending",
  "pricing": {"reserved_credits": "210"},
  "created_at": "2026-10-09T12:00:00Z"
}
```

此示例使用示意费率 `720p = 14 积分/秒`，并假定适配器只能证明 **15 秒** 的输出上限，所以先预留 `14 × 15 = 210` 积分；请求期望 6 秒不等于无条件保证实际输出不超 6 秒。若适配器能证明更紧的上限，可减少预留；没有可证明上限不得受理。个人模型 `reserved_credits` 为 `"0"`。

### 7.3 查询任务与读取视频

`GET /v1/videos/tasks/{id}` 返回 `200 OK`。对外状态为 `pending`、`running`、`succeeded`、`failed`、`unknown`、`expired`；`unknown` 表示上游结果或归档无法确认，不能自动重新提交或释放待核查预留。`failed` 只返回稳定的 `error_code`，不返回原始上游请求/响应。`expired` 表示产物已按保留策略清理，任务及计费记录仍可查询，不再给下载链接。

成功完成时的示意响应（沿用上例：实际输出 6 秒，最终结算 84 积分，释放剩余 126）：

```json
{
  "id": "video-task-id",
  "model": "grok-imagine-video-1.5@model-id",
  "mode": "image_to_video",
  "status": "succeeded",
  "output": {
    "file_id": "output-file-id",
    "url": "/v1/videos/outputs/output-file-id",
    "mime_type": "video/mp4",
    "width": 1280,
    "height": 720,
    "duration_ms": 6000,
    "byte_size": 5242880
  },
  "usage": {"resolution": "720p", "output_duration_ms": 6000, "credits": "84"},
  "created_at": "2026-10-09T12:00:00Z",
  "completed_at": "2026-10-09T12:01:00Z"
}
```

产物 URL 是同源相对路径，不含凭据或预签名 Token。`GET /v1/videos/outputs/{id}` 核对调用用户与输出归属后以流式方式传输已归档内容；支持普通 `200 OK` 和**单段** `Range: bytes=start-end` 的 `206 Partial Content`，带 `Content-Type`、`Content-Length`、`Accept-Ranges: bytes`、`Content-Range`（206 与 416）、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`。超出文件范围返回 `416` 并带 `Content-Range: bytes */<总字节数>`，不支持多段 Range；不可将大视频一次性读入内存。文件不存在、无权访问或已清理均返回 `404`，避免泄露其他用户的任务/文件是否存在。客户端须随下载请求携带 API Key；不提供无鉴权直链。

### 7.4 错误与兼容边界

错误正文沿用现有 `{"error":{"code":"...","message":"...","references":null}}` 包装；API Key 不合法或无模型调用权限返回 `401`，任务/文件不存在或不属于当前用户返回 `404`，请求格式、未声明模式/参数、图片不合规返回 `400`，余额不足无法预留返回 `402`，幂等键冲突返回 `409`，请求或上传过大返回 `413`，不可用的媒体类型返回 `415`，服务暂不可用返回 `503`。业务错误码可分别采用 `invalid_video_parameter`、`invalid_video_reference`、`unsupported_video_mode`、`insufficient_credits`、`idempotency_conflict`；不得向客户端返回供应商原始错误或凭据。上传/下载均受请求大小、存储配额和访问权限约束。

本 API 是平台异步任务协议，不兼容 OpenAI 视频 SDK 的同步返回或供应商任务查询语义；首期不提供取消、编辑、流式进度和公开回调端点。真实供应商凭据和对象存储环境的端到端行为尚待验证。
