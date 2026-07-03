/**
 * 领域类型 —— 从 Web 端 `frontend/src/api/Api.ts` 抽取出移动端实际用到的子集。
 * 字段命名与后端 JSON 保持一致。
 */

export type TaskStatus = 'pending' | 'processing' | 'error' | 'finished';
export type TaskType = 'develop' | 'design' | 'review';

export interface ApiEnvelope<T = unknown> {
  code: number;
  message?: string;
  data?: T;
}

export interface ModelBrief {
  id?: string;
  model?: string;
  remark?: string;
  provider?: string;
}

export interface TaskStats {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  llm_requests?: number;
}

/** 开发环境（VM）准备过程中的条件，task.virtualmachine.conditions 取最后一项作当前状态。 */
export type ConditionType =
  | 'Scheduled' | 'ImagePulled' | 'ProjectCloned' | 'ImageBuilt'
  | 'ContainerCreated' | 'ContainerStarted' | 'Ready' | 'Failed';
export interface Condition {
  type?: ConditionType;
  status?: number; // 0 未知 / 1 进行中 / 2 完成 / 3 失败
  reason?: string;
  message?: string;
  progress?: number; // 0-100
  last_transition_time?: number;
}

export interface ProjectTask {
  id: string;
  title?: string;
  content?: string;
  summary?: string;
  status?: TaskStatus;
  type?: TaskType;
  sub_type?: string;
  cli_name?: string;
  repo_url?: string;
  repo_filename?: string;
  branch?: string;
  full_name?: string;
  model?: ModelBrief;
  stats?: TaskStats;
  virtualmachine?: { id?: string; conditions?: Condition[] };
  created_at?: number;
  completed_at?: number;
}

export interface Project {
  id?: string;
  name?: string;
  description?: string;
  full_name?: string;
  repo_url?: string;
  platform?: string;
  auto_review_enabled?: boolean;
  created_at?: number;
  updated_at?: number;
  tasks?: ProjectTask[];
  issues?: { id?: string; status?: string }[];
}

export interface PageInfo {
  page?: number;
  size?: number;
  total?: number;
  total_count?: number;
  has_next_page?: boolean;
}

export interface ListTaskResp {
  tasks?: ProjectTask[];
  page_info?: PageInfo;
}

export interface Cursor {
  cursor?: string;
  has_more?: boolean;
}

export interface ListProjectResp {
  projects?: Project[];
  page?: Cursor;
}

/** 任务对话的原始事件块（rounds 接口返回）。data 为 base64 字符串。 */
export interface TaskChunkEntry {
  event?: string;
  kind?: string;
  data?: string;
  labels?: Record<string, string>;
  timestamp?: number;
}

export interface TaskRoundsResp {
  chunks?: TaskChunkEntry[];
  has_more?: boolean;
  next_cursor?: string;
}

export interface UserStatus {
  id?: string;
  name?: string;
  username?: string;
  email?: string;
  avatar?: string;
  avatar_url?: string;
  role?: string;
  team?: { id?: string; name?: string };
}

export interface Wallet {
  /** 积分余额（展示时需 /1000） */
  balance?: number;
  /** 每日免费模型剩余 tokens */
  daily_token_balance?: number;
  /** 每日免费模型 tokens 上限 */
  daily_token_limit?: number;
}

export interface Subscription {
  /** "basic" | "pro" | "ultra" | "flagship" */
  plan?: string;
  expires_at?: string;
  auto_renew?: boolean;
  source?: string;
}

export interface InvitationItem {
  id?: string;
  name?: string;
  avatar_url?: string;
  credits?: number;
  invited_at?: number;
}

export interface InvitationListResp {
  count?: number;
  items?: InvitationItem[];
}

export type OwnerType = 'private' | 'public' | 'team';

export interface Model {
  id?: string;
  model?: string;
  remark?: string;
  provider?: string;
  is_default?: boolean;
  is_free?: boolean;
  is_hidden?: boolean;
  access_level?: string;
  weight?: number;
  owner?: { id?: string; name?: string; type?: OwnerType };
  /** 以下字段仅自有模型（owner.type === 'private'）返回，共享模型会被后端脱敏 */
  base_url?: string;
  api_key?: string;
  interface_type?: ModelInterfaceType;
  context_limit?: number;
  output_limit?: number;
  thinking_enabled?: boolean;
  support_image?: boolean;
}

export type ModelInterfaceType = 'openai_chat' | 'openai_responses' | 'anthropic';

/** 创建自有模型请求体（对齐后端 DomainCreateModelReq） */
export interface CreateModelReq {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  interface_type: ModelInterfaceType;
  remark?: string;
  context_limit?: number;
  output_limit?: number;
  thinking_enabled?: boolean;
  support_image?: boolean;
  is_default?: boolean;
}

/** 模型健康检查结果（DomainCheckModelResp） */
export interface CheckModelResp {
  success?: boolean;
  error?: string;
}

/** 更新自有模型请求体（对齐后端 DomainUpdateModelReq，字段均可选） */
export type UpdateModelReq = Partial<CreateModelReq>;

/** 供应商可用模型项（DomainProviderModelListItem） */
export interface ProviderModelItem {
  model?: string;
}

export interface Image {
  id?: string;
  name?: string;
  remark?: string;
  is_default?: boolean;
  owner?: { id?: string; name?: string; type?: OwnerType };
}

export interface Skill {
  id?: string;
  skill_id?: string;
  name?: string;
  description?: string;
  tags?: string[];
}

/** Git 平台类型（对齐后端 consts.GitPlatform）。internal 为系统内部身份，不对用户展示。 */
export type GitPlatform = 'github' | 'gitlab' | 'gitea' | 'gitee' | 'codeup' | 'cnb' | 'atomgit' | 'internal';

/** Git 身份有权限访问的仓库（git-identities 详情接口返回）。 */
export interface AuthRepository {
  url?: string;
  full_name?: string;
  description?: string;
}

/** Git 身份凭证（对齐后端 domain.GitIdentity）。 */
export interface GitIdentity {
  id?: string;
  platform?: GitPlatform;
  base_url?: string;
  username?: string;
  email?: string;
  access_token?: string;
  remark?: string;
  organization_id?: string;
  /** true 表示通过 GitHub App 安装绑定（无需手动 token，编辑时隐藏 token 字段） */
  is_installation_app?: boolean;
  created_at?: string;
  /** 仅 git-identities 详情接口返回：该身份有权访问的仓库列表 */
  authorized_repositories?: AuthRepository[];
}

/** 添加 Git 身份请求体（对齐后端 domain.AddGitIdentityReq）。 */
export interface AddGitIdentityReq {
  platform: GitPlatform;
  base_url: string;
  access_token: string;
  username: string;
  email: string;
  remark?: string;
  organization_id?: string;
}

/** 更新 Git 身份请求体（对齐后端 domain.UpdateGitIdentityReq，字段均可选，只传需变更的）。 */
export interface UpdateGitIdentityReq {
  platform?: GitPlatform;
  base_url?: string;
  access_token?: string;
  username?: string;
  email?: string;
  remark?: string;
  organization_id?: string;
}

/** OAuth 授权地址响应（domain.OAuthURLResp）。 */
export interface OAuthURLResp {
  url?: string;
}

/** 创建项目请求体（对齐后端 domain.CreateProjectReq，移动端用到的子集）。 */
export interface CreateProjectReq {
  name?: string;
  description?: string;
  platform?: GitPlatform;
  git_identity_id?: string;
  repo_url?: string;
}

/** 创建任务请求体（对齐后端 DomainCreateTaskReq） */
export interface CreateTaskReq {
  content: string;
  cli_name: string;
  model_id: string;
  host_id: string;
  image_id: string;
  task_type: TaskType;
  repo: { repo_url?: string; branch?: string; zip_url?: string; repo_filename?: string };
  resource: { core: number; memory: number; life: number };
  extra?: { skill_ids?: string[]; project_id?: string; issue_id?: string };
  git_identity_id?: string;
}
