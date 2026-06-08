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
  daily_basic_token_balance?: number;
  daily_pro_token_balance?: number;
  daily_ultra_token_balance?: number;
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
