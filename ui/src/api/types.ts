/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export enum ConstsUserStatus {
  UserStatusActive = 'active',
  UserStatusInactive = 'inactive',
  UserStatusLocked = 'locked',
}

export enum ConstsUserPlatform {
  UserPlatformEmail = 'email',
  UserPlatformDingTalk = 'dingtalk',
}

export enum ConstsModelType {
  ModelTypeLLM = 'llm',
  ModelTypeCoder = 'coder',
  ModelTypeEmbedding = 'embedding',
  ModelTypeAudio = 'audio',
  ModelTypeReranker = 'reranker',
}

export enum ConstsModelStatus {
  ModelStatusActive = 'active',
  ModelStatusInactive = 'inactive',
}

export enum ConstsChatRole {
  ChatRoleUser = 'user',
  ChatRoleAssistant = 'assistant',
}

export enum ConstsAdminStatus {
  AdminStatusActive = 'active',
  AdminStatusInactive = 'inactive',
}

export interface DomainAcceptCompletionReq {
  /** 补全内容 */
  completion?: string;
  /** 记录ID */
  id?: string;
}

export interface DomainAdminLoginHistory {
  /** 客户端版本 */
  client_version?: string;
  /** 登录时间 */
  created_at?: number;
  /** 设备信息 */
  device?: string;
  /** IP信息 */
  ip_info?: DomainIPInfo;
  /** 用户信息 */
  user?: DomainAdminUser;
}

export interface DomainAdminUser {
  /** 创建时间 */
  created_at?: number;
  /** 用户ID */
  id?: string;
  /** 最后活跃时间 */
  last_active_at?: number;
  /** 用户状态 active: 正常 inactive: 禁用 */
  status?: ConstsAdminStatus;
  /** 用户名 */
  username?: string;
}

export interface DomainAllModelResp {
  /** 提供商列表 */
  providers?: DomainProviderModel[];
}

export interface DomainCategoryPoint {
  /** 分类 */
  category?: string;
  /** 值 */
  value?: number;
}

export interface DomainCategoryStat {
  /** 编程语言占比 */
  program_language?: DomainCategoryPoint[];
  /** 工作模式占比 */
  work_mode?: DomainCategoryPoint[];
}

export interface DomainChatContent {
  /** 内容 */
  content?: string;
  created_at?: number;
  /** 角色，如user: 用户的提问 assistant: 机器人回复 */
  role?: ConstsChatRole;
}

export interface DomainChatInfo {
  /** 消息内容 */
  contents?: DomainChatContent[];
  id?: string;
}

export interface DomainChatRecord {
  /** 创建时间 */
  created_at?: number;
  /** 记录ID */
  id?: string;
  /** 输入token */
  input_tokens?: number;
  /** 模型 */
  model?: DomainModel;
  /** 输出token */
  output_tokens?: number;
  /** 问题 */
  question?: string;
  /** 用户 */
  user?: DomainUser;
  /** 工作模式 */
  work_mode?: string;
}

export interface DomainCheckModelReq {
  /** 接口地址 */
  api_base: string;
  /** 接口密钥 */
  api_key: string;
  /** 模型名称 */
  model_name: string;
  /** 提供商 */
  provider: string;
}

export interface DomainCompletionInfo {
  content?: string;
  created_at?: number;
  id?: string;
  prompt?: string;
}

export interface DomainCompletionRecord {
  /** 创建时间 */
  created_at?: number;
  /** 记录ID */
  id?: string;
  /** 输入token */
  input_tokens?: number;
  /** 是否采纳 */
  is_accept?: boolean;
  /** 输出token */
  output_tokens?: number;
  /** 编程语言 */
  program_language?: string;
  /** 用户 */
  user?: DomainUser;
}

export interface DomainCreateAdminReq {
  /** 密码 */
  password?: string;
  /** 用户名 */
  username?: string;
}

export interface DomainCreateModelReq {
  /** 接口地址 如：https://api.qwen.com */
  api_base?: string;
  /** 接口密钥 如：sk-xxxx */
  api_key?: string;
  /** 模型名称 如: deepseek-v3 */
  model_name?: string;
  /** 模型类型 llm:对话模型 coder:代码模型 */
  model_type?: ConstsModelType;
  /** 提供商 */
  provider?: string;
}

export interface DomainIPInfo {
  /** ASN */
  asn?: string;
  /** 城市 */
  city?: string;
  /** 国家 */
  country?: string;
  /** IP地址 */
  ip?: string;
  /** 运营商 */
  isp?: string;
  /** 省份 */
  province?: string;
}

export interface DomainInviteResp {
  /** 邀请码 */
  code?: string;
}

export interface DomainListAdminLoginHistoryResp {
  has_next_page?: boolean;
  login_histories?: DomainAdminLoginHistory[];
  next_token?: string;
  total_count?: number;
}

export interface DomainListAdminUserResp {
  has_next_page?: boolean;
  next_token?: string;
  total_count?: number;
  users?: DomainAdminUser[];
}

export interface DomainListChatRecordResp {
  has_next_page?: boolean;
  next_token?: string;
  records?: DomainChatRecord[];
  total_count?: number;
}

export interface DomainListCompletionRecordResp {
  has_next_page?: boolean;
  next_token?: string;
  records?: DomainCompletionRecord[];
  total_count?: number;
}

export interface DomainListLoginHistoryResp {
  has_next_page?: boolean;
  login_histories?: DomainUserLoginHistory[];
  next_token?: string;
  total_count?: number;
}

export interface DomainListUserResp {
  has_next_page?: boolean;
  next_token?: string;
  total_count?: number;
  users?: DomainUser[];
}

export interface DomainLoginReq {
  /** 密码 */
  password?: string;
  /** 会话Id */
  session_id?: string;
  /** 用户名 */
  username?: string;
}

export interface DomainLoginResp {
  /** 重定向URL */
  redirect_url?: string;
}

export interface DomainModel {
  /** 接口地址 如：https://api.qwen.com */
  api_base?: string;
  /** 接口密钥 如：sk-xxxx */
  api_key?: string;
  /** 创建时间 */
  created_at?: number;
  /** 模型ID */
  id?: string;
  /** 输入token数 */
  input?: number;
  /** 是否启用 */
  is_active?: boolean;
  /** 模型名称 如: deepseek-v3 */
  model_name?: string;
  /** 模型类型 llm:对话模型 coder:代码模型 */
  model_type?: ConstsModelType;
  /** 输出token数 */
  output?: number;
  /** 提供商 */
  provider?: string;
  /** 状态 active:启用 inactive:禁用 */
  status?: ConstsModelStatus;
  /** 更新时间 */
  updated_at?: number;
}

export interface DomainModelBasic {
  /** 接口地址 如：https://api.qwen.com */
  api_base?: string;
  /** 模型名称 */
  name?: string;
  /** 提供商 */
  provider?: string;
}

export interface DomainModelData {
  api_base?: string;
  base_model?: string;
  created?: number;
  id?: string;
  is_active?: boolean;
  name?: string;
  object?: string;
  owned_by?: string;
  type?: string;
}

export interface DomainModelListResp {
  data?: DomainModelData[];
  object?: string;
}

export interface DomainModelTokenUsage {
  /** 时间戳 */
  timestamp?: number;
  /** 使用token数 */
  tokens?: number;
}

export interface DomainModelTokenUsageResp {
  /** 输入token使用记录 */
  input_usage?: DomainModelTokenUsage[];
  /** 输出token使用记录 */
  output_usage?: DomainModelTokenUsage[];
  /** 总输入token数 */
  total_input?: number;
  /** 总输出token数 */
  total_output?: number;
}

export interface DomainOAuthURLResp {
  url?: string;
}

export interface DomainProviderModel {
  /** 模型列表 */
  models?: DomainModelBasic[];
  /** 提供商 */
  provider?: string;
}

export interface DomainRegisterReq {
  /** 邀请码 */
  code: string;
  /** 邮箱 */
  email: string;
  /** 密码 */
  password: string;
  /** 用户名 */
  username: string;
}

export interface DomainSetting {
  /** 创建时间 */
  created_at?: number;
  /** 是否禁用密码登录 */
  disable_password_login?: boolean;
  /** 是否开启钉钉OAuth */
  enable_dingtalk_oauth?: boolean;
  /** 是否开启SSO */
  enable_sso?: boolean;
  /** 是否强制两步验证 */
  force_two_factor_auth?: boolean;
  /** 更新时间 */
  updated_at?: number;
}

export interface DomainStatistics {
  /** 禁用用户数 */
  disabled_users?: number;
  /** 总用户数 */
  total_users?: number;
}

export interface DomainTimeStat {
  /** 接受率统计 */
  accepted_per?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 活跃用户数统计 */
  active_users?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 对话任务数统计 */
  chats?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 补全任务数统计 */
  code_completions?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 代码行数统计 */
  lines_of_code?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 实时token数统计 */
  real_time_tokens?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 近90天平均接受率 */
  total_accepted_per?: number;
  /** 近90天对话任务数 */
  total_chats?: number;
  /** 近90天补全任务数 */
  total_completions?: number;
  /** 近90天代码行数 */
  total_lines_of_code?: number;
  /** 近90天活跃用户数 */
  total_users?: number;
}

export interface DomainUpdateModelReq {
  /** 接口地址 如：https://api.qwen.com */
  api_base?: string;
  /** 接口密钥 如：sk-xxxx */
  api_key?: string;
  /** 模型ID */
  id?: string;
  /** 模型名称 */
  model_name?: string;
  /** 提供商 */
  provider?: string;
  /** 状态 active:启用 inactive:禁用 */
  status?: ConstsModelStatus;
}

export interface DomainUpdateSettingReq {
  /** 钉钉客户端ID */
  dingtalk_client_id?: string;
  /** 钉钉客户端密钥 */
  dingtalk_client_secret?: string;
  /** 是否禁用密码登录 */
  disable_password_login?: boolean;
  /** 是否开启钉钉OAuth */
  enable_dingtalk_oauth?: boolean;
  /** 是否开启SSO */
  enable_sso?: boolean;
  /** 是否强制两步验证 */
  force_two_factor_auth?: boolean;
}

export interface DomainUpdateUserReq {
  /** 用户ID */
  id: string;
  /** 重置密码 */
  password?: string;
  /** 用户状态 active: 正常 locked: 锁定 inactive: 禁用 */
  status?: ConstsUserStatus;
}

export interface DomainUser {
  /** 创建时间 */
  created_at?: number;
  /** 邮箱 */
  email?: string;
  /** 用户ID */
  id?: string;
  /** 最后活跃时间 */
  last_active_at?: number;
  /** 用户状态 active: 正常 locked: 锁定 inactive: 禁用 */
  status?: ConstsUserStatus;
  /** 是否开启两步验证 */
  two_step_auth?: boolean;
  /** 用户名 */
  username?: string;
}

export interface DomainUserCodeRank {
  /** 代码行数 */
  lines?: number;
  /** 用户名 */
  username?: string;
}

export interface DomainUserEvent {
  /** 事件时间 */
  created_at?: number;
  /** 事件名称 */
  name?: string;
}

export interface DomainUserHeatmap {
  count?: number;
  date?: number;
}

export interface DomainUserHeatmapResp {
  max_count?: number;
  points?: DomainUserHeatmap[];
}

export interface DomainUserLoginHistory {
  /** 客户端版本 */
  client_version?: string;
  /** 登录时间 */
  created_at?: number;
  /** 设备信息 */
  device?: string;
  /** IP信息 */
  ip_info?: DomainIPInfo;
  /** 用户信息 */
  user?: DomainUser;
}

export interface DomainUserStat {
  /** 接受率统计 */
  accepted_per?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 对话任务数统计 */
  chats?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 补全任务数统计 */
  code_completions?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 代码行数统计 */
  lines_of_code?: {
    /** 时间戳 */
    timestamp?: number;
    /** 值 */
    value?: number;
  }[];
  /** 编程语言占比 */
  program_language?: DomainCategoryPoint[];
  /** 近90天总接受率 */
  total_accepted_per?: number;
  /** 近90天总对话任务数 */
  total_chats?: number;
  /** 近90天总补全任务数 */
  total_completions?: number;
  /** 近90天总代码行数 */
  total_lines_of_code?: number;
  /** 工作模式占比 */
  work_mode?: DomainCategoryPoint[];
}

export interface WebResp {
  code?: number;
  data?: unknown;
  message?: string;
}

export interface DeleteDeleteAdminParams {
  /** 管理员ID */
  id: string;
}

export interface GetListAdminUserParams {
  /** 下一页标识 */
  next_token?: string;
  /** 分页 */
  page?: number;
  /** 每页多少条记录 */
  size?: number;
}

export interface GetAdminLoginHistoryParams {
  /** 下一页标识 */
  next_token?: string;
  /** 分页 */
  page?: number;
  /** 每页多少条记录 */
  size?: number;
}

export interface GetChatInfoParams {
  /** 对话记录ID */
  id: string;
}

export interface GetListChatRecordParams {
  /** 作者 */
  author?: string;
  /** 是否接受筛选 */
  is_accept?: boolean;
  /** 语言 */
  language?: string;
  /** 下一页标识 */
  next_token?: string;
  /** 分页 */
  page?: number;
  /** 每页多少条记录 */
  size?: number;
}

export interface GetCompletionInfoParams {
  /** 补全记录ID */
  id: string;
}

export interface GetListCompletionRecordParams {
  /** 作者 */
  author?: string;
  /** 是否接受筛选 */
  is_accept?: boolean;
  /** 语言 */
  language?: string;
  /** 下一页标识 */
  next_token?: string;
  /** 分页 */
  page?: number;
  /** 每页多少条记录 */
  size?: number;
}

export interface GetCategoryStatDashboardParams {
  /**
   * 持续时间 (小时或天数)`
   * @min 24
   * @max 90
   */
  duration?: number;
  /** 精度: "hour", "day" */
  precision: 'hour' | 'day';
  /** 用户ID，可jj */
  user_id?: string;
}

export interface GetTimeStatDashboardParams {
  /**
   * 持续时间 (小时或天数)`
   * @min 24
   * @max 90
   */
  duration?: number;
  /** 精度: "hour", "day" */
  precision: 'hour' | 'day';
  /** 用户ID，可jj */
  user_id?: string;
}

export interface GetUserCodeRankDashboardParams {
  /**
   * 持续时间 (小时或天数)`
   * @min 24
   * @max 90
   */
  duration?: number;
  /** 精度: "hour", "day" */
  precision: 'hour' | 'day';
  /** 用户ID，可jj */
  user_id?: string;
}

export interface GetUserEventsDashboardParams {
  /**
   * 持续时间 (小时或天数)`
   * @min 24
   * @max 90
   */
  /** 用户ID，可jj */
  user_id?: string;
}

export interface GetUserHeatmapDashboardParams {
  /** 用户ID */
  user_id: string;
}

export interface GetUserStatDashboardParams {
  /**
   * 持续时间 (小时或天数)`
   * @min 24
   * @max 90
   */
  duration?: number;
  /** 精度: "hour", "day" */
  precision: 'hour' | 'day';
  /** 用户ID，可jj */
  user_id?: string;
}

export interface GetMyModelListParams {
  /** 模型类型 llm:对话模型 coder:代码模型 */
  model_type?: 'llm' | 'coder' | 'embedding' | 'audio' | 'reranker';
}

export interface GetGetTokenUsageParams {
  /** 模型类型 llm:对话模型 coder:代码模型 */
  model_type: 'llm' | 'coder' | 'embedding' | 'audio' | 'reranker';
}

export interface DeleteDeleteUserParams {
  /** 用户ID */
  id: string;
}

export interface GetListUserParams {
  /** 下一页标识 */
  next_token?: string;
  /** 分页 */
  page?: number;
  /** 每页多少条记录 */
  size?: number;
}

export interface GetLoginHistoryParams {
  /** 下一页标识 */
  next_token?: string;
  /** 分页 */
  page?: number;
  /** 每页多少条记录 */
  size?: number;
}

export interface GetUserOauthCallbackParams {
  code: string;
  state: string;
}

export interface GetUserOauthSignupOrInParams {
  /** 第三方平台 dingtalk */
  platform: 'email' | 'dingtalk';
  /** 登录成功后跳转的 URL */
  redirect_url?: string;
  /** 会话ID */
  session_id?: string;
}
