/* eslint-disable */
/* tslint:disable */
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

import {
  DomainAddGitIdentityReq,
  DomainAddTeamAdminReq,
  DomainAddTeamAdminResp,
  DomainAddTeamGroupReq,
  DomainAddTeamGroupUsersReq,
  DomainAddTeamGroupUsersResp,
  DomainAddTeamImageReq,
  DomainAddTeamModelReq,
  DomainAddTeamOAuthSiteReq,
  DomainAddTeamUserReq,
  DomainAddTeamUserResp,
  DomainApplyPortReq,
  DomainBranch,
  DomainChangePasswordReq,
  DomainCheckByConfigReq,
  DomainCheckModelResp,
  DomainCreateFeedbackReq,
  DomainCreateGitBotReq,
  DomainCreateImageReq,
  DomainCreateIssueCommentReq,
  DomainCreateIssueReq,
  DomainCreateModelReq,
  DomainCreateProjectReq,
  DomainCreateTaskReq,
  DomainCreateVMReq,
  DomainDeleteImageReq,
  DomainExchangeReq,
  DomainFeedback,
  DomainFileChangeReq,
  DomainFilePathReq,
  DomainFileSaveReq,
  DomainGetProviderModelListResp,
  DomainGitBot,
  DomainGitIdentity,
  DomainHostListResp,
  DomainImage,
  DomainInstallCommand,
  DomainListAuditsResponse,
  DomainListCollaboratorsResp,
  DomainListFeedbacksResp,
  DomainListGitBotResp,
  DomainListGitBotTaskResp,
  DomainListImageResp,
  DomainListIssueCommentsResp,
  DomainListIssuesResp,
  DomainListModelResp,
  DomainListPlaygroundPostResp,
  DomainListProjectResp,
  DomainListTaskResp,
  DomainListTeamGroupsResp,
  DomainListTeamHostsResp,
  DomainListTeamImagesResp,
  DomainListTeamModelsResp,
  DomainListTeamOAuthSitesResp,
  DomainListTransactionResp,
  DomainListUserPlaygroundPostResp,
  DomainMemberListResp,
  DomainModel,
  DomainOAuthURLResp,
  DomainPlaygroundPost,
  DomainPresignReq,
  DomainPresignResp,
  DomainProject,
  DomainProjectBlob,
  DomainProjectIssue,
  DomainProjectIssueComment,
  DomainProjectLogs,
  DomainProjectTask,
  DomainProjectTreeEntry,
  DomainRecyclePortReq,
  DomainRedeemCaptchaReq,
  DomainResetUserPasswordEmailReq,
  DomainResetUserPasswordReq,
  DomainShareGitBotReq,
  DomainSharePostReq,
  DomainSharePostResp,
  DomainShareTaskReq,
  DomainShareTaskResp,
  DomainShareTerminalReq,
  DomainShareTerminalResp,
  DomainSitesResp,
  DomainSkill,
  DomainSpeechRecognitionEvent,
  DomainStats,
  DomainTask,
  DomainTeamGroup,
  DomainTeamImage,
  DomainTeamLoginReq,
  DomainTeamModel,
  DomainTeamOAuthSite,
  DomainTeamUser,
  DomainTeamUserInfo,
  DomainTerminal,
  DomainUpdateGitBotReq,
  DomainUpdateGitIdentityReq,
  DomainUpdateHostReq,
  DomainUpdateImageReq,
  DomainUpdateIssueReq,
  DomainUpdateModelReq,
  DomainUpdateProjectReq,
  DomainUpdateTeamGroupReq,
  DomainUpdateTeamHostReq,
  DomainUpdateTeamImageReq,
  DomainUpdateTeamModelReq,
  DomainUpdateTeamOAuthSiteReq,
  DomainUpdateTeamUserReq,
  DomainUpdateTeamUserResp,
  DomainUpdateUserResp,
  DomainUpdateVMReq,
  DomainUser,
  DomainVirtualMachine,
  DomainVMPort,
  DomainWallet,
  GitInChaitinNetAiMonkeycodeMonkeycodeAiDomainIDReqGithubComGoogleUuidUUID,
  GocapChallengeData,
  GocapVerificationResult,
  TypesFile,
  WebResp,
} from "./data-contracts";
import { ContentType, HttpClient, RequestParams } from "./http-client";

export class Api<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {
  /**
   * @description 获取 Gitea OAuth 授权 URL
   *
   * @tags 【用户】git 身份管理
   * @name V1GiteaAuthorizeUrlList
   * @summary Gitea OAuth 授权
   * @request GET:/api/v1/gitea/authorize_url
   * @secure
   */
  v1GiteaAuthorizeUrlList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainOAuthURLResp;
      },
      WebResp
    >({
      path: `/api/v1/gitea/authorize_url`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 返回合并后的 Gitea 站点列表（团队配置优先，全局配置兜底），不含凭证信息
   *
   * @tags 站点管理
   * @name V1GiteaSitesList
   * @summary 获取 Gitea 可用站点列表
   * @request GET:/api/v1/gitea/sites
   * @secure
   */
  v1GiteaSitesList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainSitesResp;
      },
      WebResp
    >({
      path: `/api/v1/gitea/sites`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取 Gitee OAuth 授权 URL
   *
   * @tags 【用户】git 身份管理
   * @name V1GiteeAuthorizeUrlList
   * @summary Gitee OAuth 授权
   * @request GET:/api/v1/gitee/authorize_url
   * @secure
   */
  v1GiteeAuthorizeUrlList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainOAuthURLResp;
      },
      WebResp
    >({
      path: `/api/v1/gitee/authorize_url`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取 GitLab OAuth 授权 URL
   *
   * @tags 【用户】git 身份管理
   * @name V1GitlabAuthorizeUrlList
   * @summary GitLab OAuth 授权
   * @request GET:/api/v1/gitlab/authorize_url
   * @secure
   */
  v1GitlabAuthorizeUrlList = (
    query: {
      /** GitLab 实例 Base URL */
      base: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainOAuthURLResp;
      },
      WebResp
    >({
      path: `/api/v1/gitlab/authorize_url`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 返回合并后的 GitLab 站点列表（团队配置优先，全局配置兜底），不含凭证信息
   *
   * @tags 站点管理
   * @name V1GitlabSitesList
   * @summary 获取 GitLab 可用站点列表
   * @request GET:/api/v1/gitlab/sites
   * @secure
   */
  v1GitlabSitesList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainSitesResp;
      },
      WebResp
    >({
      path: `/api/v1/gitlab/sites`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 绑定第三方平台
   *
   * @tags 【用户】OAuth
   * @name OauthBindUsers
   * @summary 绑定第三方平台
   * @request GET:/api/v1/oauth/bind
   * @secure
   */
  oauthBindUsers = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainOAuthURLResp;
      },
      WebResp
    >({
      path: `/api/v1/oauth/bind`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description 获取当前登录用户绑定的百知云平台用户信息，包括百知云账号和对应的MonkeyCode账号详情
   *
   * @tags 【用户】OAuth
   * @name OauthGetBoundUsers
   * @summary 获取绑定的平台用户信息
   * @request GET:/api/v1/oauth/bind-users
   * @secure
   */
  oauthGetBoundUsers = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainUser;
      },
      WebResp
    >({
      path: `/api/v1/oauth/bind-users`,
      method: "GET",
      secure: true,
      format: "json",
      ...params,
    });
  /**
   * @description 处理 Gitea OAuth 回调
   *
   * @tags 【用户】git 身份管理
   * @name V1OauthGiteaCallbackList
   * @summary Gitea OAuth 回调
   * @request GET:/api/v1/oauth/gitea/callback
   */
  v1OauthGiteaCallbackList = (
    query: {
      /** 授权码 */
      code: string;
      /** 状态码 */
      state: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, string>({
      path: `/api/v1/oauth/gitea/callback`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description 处理 Gitee OAuth 回调
   *
   * @tags 【用户】git 身份管理
   * @name V1OauthGiteeCallbackList
   * @summary Gitee OAuth 回调
   * @request GET:/api/v1/oauth/gitee/callback
   */
  v1OauthGiteeCallbackList = (
    query: {
      /** 授权码 */
      code: string;
      /** 状态码 */
      state: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, string>({
      path: `/api/v1/oauth/gitee/callback`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description 处理 GitLab OAuth 回调
   *
   * @tags 【用户】git 身份管理
   * @name V1OauthGitlabCallbackList
   * @summary GitLab OAuth 回调
   * @request GET:/api/v1/oauth/gitlab/callback
   */
  v1OauthGitlabCallbackList = (
    query: {
      /** 授权码 */
      code: string;
      /** 状态码 */
      state: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, string>({
      path: `/api/v1/oauth/gitlab/callback`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description 解除当前登录用户与第三方平台（GitHub/GitLab/Gitee/Gitea）账号的绑定关系
   *
   * @tags 【用户】OAuth
   * @name OauthUnbind
   * @summary 解绑第三方平台账号
   * @request DELETE:/api/v1/oauth/unbind
   * @secure
   */
  oauthUnbind = (
    query: {
      /** 第三方平台 */
      platform: "github" | "gitlab" | "gitee" | "gitea";
    },
    params: RequestParams = {},
  ) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/oauth/unbind`,
      method: "DELETE",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取广场帖子列表，支持游标分页
   *
   * @tags 【公开】广场
   * @name V1PlaygroundPostsList
   * @summary 获取广场帖子列表
   * @request GET:/api/v1/playground-posts
   */
  v1PlaygroundPostsList = (
    query?: {
      /** 内容 */
      content?: string;
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      kind?: "task" | "project" | "normal";
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListPlaygroundPostResp;
      },
      WebResp
    >({
      path: `/api/v1/playground-posts`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取广场帖子详情
   *
   * @tags 【公开】广场
   * @name V1PlaygroundPostsDetail
   * @summary 获取广场帖子详情
   * @request GET:/api/v1/playground-posts/{id}
   */
  v1PlaygroundPostsDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainPlaygroundPost;
      },
      WebResp
    >({
      path: `/api/v1/playground-posts/${id}`,
      method: "GET",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description CreateCaptcha
   *
   * @tags 【验证码】
   * @name V1PublicCaptchaChallengeCreate
   * @summary CreateCaptcha
   * @request POST:/api/v1/public/captcha/challenge
   */
  v1PublicCaptchaChallengeCreate = (params: RequestParams = {}) =>
    this.request<GocapChallengeData, any>({
      path: `/api/v1/public/captcha/challenge`,
      method: "POST",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description RedeemCaptcha
   *
   * @tags 【验证码】
   * @name V1PublicCaptchaRedeemCreate
   * @summary RedeemCaptcha
   * @request POST:/api/v1/public/captcha/redeem
   */
  v1PublicCaptchaRedeemCreate = (body: DomainRedeemCaptchaReq, params: RequestParams = {}) =>
    this.request<GocapVerificationResult, any>({
      path: `/api/v1/public/captcha/redeem`,
      method: "POST",
      body: body,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 问题反馈列表，支持按状态、类型、时间过滤
   *
   * @tags 【用户】问题反馈
   * @name V1PublicFeedbacksList
   * @summary 问题反馈列表
   * @request GET:/api/v1/public/feedbacks
   */
  v1PublicFeedbacksList = (
    query?: {
      /** 状态过滤 */
      status?: string;
      /** 类型过滤 */
      type?: string;
      /** 创建开始时间 */
      created_at_start?: string;
      /** 创建结束时间 */
      created_at_end?: string;
      /** 游标 */
      cursor?: string;
      /** 每页数量 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListFeedbacksResp;
      },
      WebResp
    >({
      path: `/api/v1/public/feedbacks`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 问题反馈详情
   *
   * @tags 【用户】问题反馈
   * @name V1PublicFeedbacksDetail
   * @summary 问题反馈详情
   * @request GET:/api/v1/public/feedbacks/{id}
   */
  v1PublicFeedbacksDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainFeedback;
      },
      WebResp
    >({
      path: `/api/v1/public/feedbacks/${id}`,
      method: "GET",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取数据总览
   *
   * @tags 【公共】欢迎页
   * @name V1PublicStatsList
   * @summary 获取数据总览
   * @request GET:/api/v1/public/stats
   */
  v1PublicStatsList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainStats;
      },
      any
    >({
      path: `/api/v1/public/stats`,
      method: "GET",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取所有已启用的 Skills
   *
   * @tags 【公共】skill
   * @name V1SkillsList
   * @summary 获取已启用的 Skills 列表
   * @request GET:/api/v1/skills
   * @secure
   */
  v1SkillsList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainSkill[];
      },
      WebResp
    >({
      path: `/api/v1/skills`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建团队管理员，将用户添加到团队并设置为管理员角色
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsAdminCreate
   * @summary 创建团队管理员
   * @request POST:/api/v1/teams/admin
   * @secure
   */
  v1TeamsAdminCreate = (req: DomainAddTeamAdminReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainAddTeamAdminResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/admin`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 查询审计日志列表，支持条件过滤和分页
   *
   * @tags 【Team管理员】审计日志
   * @name V1TeamsAuditsList
   * @summary 查询审计日志
   * @request GET:/api/v1/teams/audits
   * @secure
   */
  v1TeamsAuditsList = (
    query?: {
      created_at_end?: string;
      created_at_start?: string;
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
      operation?: string;
      request?: string;
      response?: string;
      source_ip?: string;
      user_agent?: string;
      user_id?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<DomainListAuditsResponse, WebResp>({
      path: `/api/v1/teams/audits`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队分组列表
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsGroupsList
   * @summary 获取团队分组列表
   * @request GET:/api/v1/teams/groups
   * @secure
   */
  v1TeamsGroupsList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainListTeamGroupsResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/groups`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建团队分组
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsGroupsCreate
   * @summary 创建团队分组
   * @request POST:/api/v1/teams/groups
   * @secure
   */
  v1TeamsGroupsCreate = (req: DomainAddTeamGroupReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamGroup;
      },
      WebResp
    >({
      path: `/api/v1/teams/groups`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新团队分组
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsGroupsUpdate
   * @summary 更新团队分组
   * @request PUT:/api/v1/teams/groups/{group_id}
   * @secure
   */
  v1TeamsGroupsUpdate = (groupId: string, req: DomainUpdateTeamGroupReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamGroup;
      },
      WebResp
    >({
      path: `/api/v1/teams/groups/${groupId}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除团队分组
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsGroupsDelete
   * @summary 删除团队分组
   * @request DELETE:/api/v1/teams/groups/{group_id}
   * @secure
   */
  v1TeamsGroupsDelete = (groupId: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/teams/groups/${groupId}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 修改团队组成员
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsGroupsUsersUpdate
   * @summary 修改团队组成员
   * @request PUT:/api/v1/teams/groups/{group_id}/users
   * @secure
   */
  v1TeamsGroupsUsersUpdate = (groupId: string, req: DomainAddTeamGroupUsersReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainAddTeamGroupUsersResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/groups/${groupId}/users`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队宿主机列表
   *
   * @tags 【Team 管理员】宿主机管理
   * @name V1TeamsHostsList
   * @summary 获取团队宿主机列表
   * @request GET:/api/v1/teams/hosts
   * @secure
   */
  v1TeamsHostsList = (
    query?: {
      /** 下一页标识 */
      next_token?: string;
      /** 分页 */
      page?: number;
      /** 每页多少条记录 */
      size?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListTeamHostsResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/hosts`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取宿主机安装命令
   *
   * @tags 【Team 管理员】宿主机管理
   * @name V1TeamsHostsInstallCommandList
   * @summary 获取宿主机安装命令
   * @request GET:/api/v1/teams/hosts/install-command
   * @secure
   */
  v1TeamsHostsInstallCommandList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainInstallCommand;
      },
      WebResp
    >({
      path: `/api/v1/teams/hosts/install-command`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新团队宿主机
   *
   * @tags 【Team 管理员】宿主机管理
   * @name V1TeamsHostsUpdate
   * @summary 更新团队宿主机
   * @request PUT:/api/v1/teams/hosts/{host_id}
   * @secure
   */
  v1TeamsHostsUpdate = (hostId: string, param: DomainUpdateTeamHostReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/teams/hosts/${hostId}`,
      method: "PUT",
      body: param,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除团队宿主机
   *
   * @tags 【Team 管理员】宿主机管理
   * @name V1TeamsHostsDelete
   * @summary 删除团队宿主机
   * @request DELETE:/api/v1/teams/hosts/{host_id}
   * @secure
   */
  v1TeamsHostsDelete = (hostId: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/teams/hosts/${hostId}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队镜像列表
   *
   * @tags 【Team 管理员】镜像管理
   * @name V1TeamsImagesList
   * @summary 获取团队镜像列表
   * @request GET:/api/v1/teams/images
   * @secure
   */
  v1TeamsImagesList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainListTeamImagesResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/images`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 添加团队镜像
   *
   * @tags 【Team 管理员】镜像管理
   * @name V1TeamsImagesCreate
   * @summary 添加团队镜像
   * @request POST:/api/v1/teams/images
   * @secure
   */
  v1TeamsImagesCreate = (req: DomainAddTeamImageReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamImage;
      },
      WebResp
    >({
      path: `/api/v1/teams/images`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新团队镜像
   *
   * @tags 【Team 管理员】镜像管理
   * @name V1TeamsImagesUpdate
   * @summary 更新团队镜像
   * @request PUT:/api/v1/teams/images/{image_id}
   * @secure
   */
  v1TeamsImagesUpdate = (imageId: string, req: DomainUpdateTeamImageReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamImage;
      },
      WebResp
    >({
      path: `/api/v1/teams/images/${imageId}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除团队镜像
   *
   * @tags 【Team 管理员】镜像管理
   * @name V1TeamsImagesDelete
   * @summary 删除团队镜像
   * @request DELETE:/api/v1/teams/images/{image_id}
   * @secure
   */
  v1TeamsImagesDelete = (imageId: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/teams/images/${imageId}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队模型配置列表
   *
   * @tags 【Team 管理员】模型管理
   * @name V1TeamsModelsList
   * @summary 获取团队模型配置列表
   * @request GET:/api/v1/teams/models
   * @secure
   */
  v1TeamsModelsList = (
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListTeamModelsResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/models`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 添加团队模型配置
   *
   * @tags 【Team 管理员】模型管理
   * @name V1TeamsModelsCreate
   * @summary 添加团队模型配置
   * @request POST:/api/v1/teams/models
   * @secure
   */
  v1TeamsModelsCreate = (req: DomainAddTeamModelReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamModel;
      },
      WebResp
    >({
      path: `/api/v1/teams/models`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 使用提供的配置进行健康检查，不更新数据库
   *
   * @tags 【Team 管理员】模型管理
   * @name V1TeamsModelsHealthCheckCreate
   * @summary 检查团队模型健康状态（通过配置）
   * @request POST:/api/v1/teams/models/health-check
   * @secure
   */
  v1TeamsModelsHealthCheckCreate = (req: DomainCheckByConfigReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainCheckModelResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/models/health-check`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 对指定团队模型进行健康检查，并更新检查结果到数据库
   *
   * @tags 【Team 管理员】模型管理
   * @name V1TeamsModelsHealthCheckDetail
   * @summary 检查团队模型健康状态（通过ID）
   * @request GET:/api/v1/teams/models/{id}/health-check
   * @secure
   */
  v1TeamsModelsHealthCheckDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainCheckModelResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/models/${id}/health-check`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新团队模型配置
   *
   * @tags 【Team 管理员】模型管理
   * @name V1TeamsModelsUpdate
   * @summary 更新团队模型配置
   * @request PUT:/api/v1/teams/models/{model_id}
   * @secure
   */
  v1TeamsModelsUpdate = (modelId: string, req: DomainUpdateTeamModelReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamModel;
      },
      WebResp
    >({
      path: `/api/v1/teams/models/${modelId}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除团队模型配置
   *
   * @tags 【Team 管理员】模型管理
   * @name V1TeamsModelsDelete
   * @summary 删除团队模型配置
   * @request DELETE:/api/v1/teams/models/{model_id}
   * @secure
   */
  v1TeamsModelsDelete = (modelId: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/teams/models/${modelId}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队 OAuth 站点列表
   *
   * @tags 【Team 管理员】OAuth 站点管理
   * @name V1TeamsOauthSitesList
   * @summary 获取团队 OAuth 站点列表
   * @request GET:/api/v1/teams/oauth-sites
   * @secure
   */
  v1TeamsOauthSitesList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainListTeamOAuthSitesResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/oauth-sites`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 添加团队 OAuth 站点
   *
   * @tags 【Team 管理员】OAuth 站点管理
   * @name V1TeamsOauthSitesCreate
   * @summary 添加团队 OAuth 站点
   * @request POST:/api/v1/teams/oauth-sites
   * @secure
   */
  v1TeamsOauthSitesCreate = (req: DomainAddTeamOAuthSiteReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamOAuthSite;
      },
      WebResp
    >({
      path: `/api/v1/teams/oauth-sites`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新团队 OAuth 站点
   *
   * @tags 【Team 管理员】OAuth 站点管理
   * @name V1TeamsOauthSitesUpdate
   * @summary 更新团队 OAuth 站点
   * @request PUT:/api/v1/teams/oauth-sites/{site_id}
   * @secure
   */
  v1TeamsOauthSitesUpdate = (siteId: string, req: DomainUpdateTeamOAuthSiteReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamOAuthSite;
      },
      WebResp
    >({
      path: `/api/v1/teams/oauth-sites/${siteId}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除团队 OAuth 站点
   *
   * @tags 【Team 管理员】OAuth 站点管理
   * @name V1TeamsOauthSitesDelete
   * @summary 删除团队 OAuth 站点
   * @request DELETE:/api/v1/teams/oauth-sites/{site_id}
   * @secure
   */
  v1TeamsOauthSitesDelete = (siteId: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/teams/oauth-sites/${siteId}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队成员列表，支持按角色筛选
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsUsersList
   * @summary 获取团队成员列表
   * @request GET:/api/v1/teams/users
   * @secure
   */
  v1TeamsUsersList = (
    query?: {
      /** 团队成员角色筛选（可选值：admin, user） */
      role?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainMemberListResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/users`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建团队成员，发送重置密码邮件
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsUsersCreate
   * @summary 创建团队成员
   * @request POST:/api/v1/teams/users
   * @secure
   */
  v1TeamsUsersCreate = (req: DomainAddTeamUserReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainAddTeamUserResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/users`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 团队用户登录，password 字段需要传 MD5 加密后的值
   *
   * @tags 【Team 管理员】认证
   * @name V1TeamsUsersLoginCreate
   * @summary 团队用户登录
   * @request POST:/api/v1/teams/users/login
   */
  v1TeamsUsersLoginCreate = (req: DomainTeamLoginReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamUser;
      },
      WebResp
    >({
      path: `/api/v1/teams/users/login`,
      method: "POST",
      body: req,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 团队用户登出
   *
   * @tags 【Team 管理员】认证
   * @name V1TeamsUsersLogoutCreate
   * @summary 团队用户登出
   * @request POST:/api/v1/teams/users/logout
   */
  v1TeamsUsersLogoutCreate = (params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/teams/users/logout`,
      method: "POST",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 修改当前用户的密码
   *
   * @tags 【Team 管理员】认证
   * @name V1TeamsUsersPasswordsChangeUpdate
   * @summary 修改密码
   * @request PUT:/api/v1/teams/users/passwords/change
   * @secure
   */
  v1TeamsUsersPasswordsChangeUpdate = (req: DomainChangePasswordReq, params: RequestParams = {}) =>
    this.request<WebResp, any>({
      path: `/api/v1/teams/users/passwords/change`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队用户登录状态
   *
   * @tags 【Team 管理员】认证
   * @name V1TeamsUsersStatusList
   * @summary 获取团队用户登录状态
   * @request GET:/api/v1/teams/users/status
   */
  v1TeamsUsersStatusList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamUser;
      },
      WebResp
    >({
      path: `/api/v1/teams/users/status`,
      method: "GET",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新团队用户的 is_blocked 字段状态
   *
   * @tags 【Team 管理员】分组成员管理
   * @name V1TeamsUsersUpdate
   * @summary 更新团队用户信息
   * @request PUT:/api/v1/teams/users/{user_id}
   * @secure
   */
  v1TeamsUsersUpdate = (userId: string, req: DomainUpdateTeamUserReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainUpdateTeamUserResp;
      },
      WebResp
    >({
      path: `/api/v1/teams/users/${userId}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 通用文件上传接口，支持图片和文件上传到 OSS。上传成功后返回文件的访问 URL。
   *
   * @tags 【上传】上传
   * @name V1UploaderCreate
   * @summary 文件上传
   * @request POST:/api/v1/uploader
   * @secure
   */
  v1UploaderCreate = (
    data: {
      /** 上传用途，可选值: avatar(头像), spec(规格), repo(仓库) */
      usage: string;
      /**
       * 要上传的文件
       * @format binary
       */
      file: File;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: string;
      },
      WebResp
    >({
      path: `/api/v1/uploader`,
      method: "POST",
      body: data,
      secure: true,
      type: ContentType.FormData,
      format: "json",
      ...params,
    });
  /**
   * @description 获取预签名上传URL，客户端可以使用该URL直接上传文件到OSS（使用PUT方法）
   *
   * @tags 【上传】上传
   * @name V1UploaderPresignCreate
   * @summary 获取预签名上传URL
   * @request POST:/api/v1/uploader/presign
   * @secure
   */
  v1UploaderPresignCreate = (request: DomainPresignReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainPresignResp;
      },
      WebResp
    >({
      path: `/api/v1/uploader/presign`,
      method: "POST",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新用户昵称和头像
   *
   * @tags 【用户】用户
   * @name V1UsersUpdate
   * @summary 更新用户信息
   * @request PUT:/api/v1/users
   * @secure
   */
  v1UsersUpdate = (
    data: {
      /** 昵称 */
      name?: string;
      /** OSS 头像地址 */
      avatar_url?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<DomainUpdateUserResp, WebResp>({
      path: `/api/v1/users`,
      method: "PUT",
      body: data,
      secure: true,
      type: ContentType.FormData,
      format: "json",
      ...params,
    });
  /**
   * @description 处理百智云登录回调，验证 token 并建立会话
   *
   * @tags 【用户】认证
   * @name V1UsersBaizhiCallbackList
   * @summary 百智云登录回调
   * @request GET:/api/v1/users/baizhi/callback
   */
  v1UsersBaizhiCallbackList = (
    query: {
      /** 百智云返回的授权码 */
      code: string;
      /** 用户原本想访问的页面 */
      state?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, string>({
      path: `/api/v1/users/baizhi/callback`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description 创建问题反馈
   *
   * @tags 【用户】问题反馈
   * @name V1UsersFeedbacksCreate
   * @summary 创建问题反馈
   * @request POST:/api/v1/users/feedbacks
   * @secure
   */
  v1UsersFeedbacksCreate = (req: DomainCreateFeedbackReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainFeedback;
      },
      WebResp
    >({
      path: `/api/v1/users/feedbacks`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除文件/目录
   *
   * @tags 【用户】文件管理
   * @name V1UsersFilesDelete
   * @summary 删除文件/目录
   * @request DELETE:/api/v1/users/files
   * @secure
   */
  v1UsersFilesDelete = (
    query: {
      /** 虚拟机 id */
      id: string;
      /** 文件/目录路径 */
      path: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/files`,
      method: "DELETE",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 复制文件/目录
   *
   * @tags 【用户】文件管理
   * @name V1UsersFilesCopyCreate
   * @summary 复制文件/目录
   * @request POST:/api/v1/users/files/copy
   * @secure
   */
  v1UsersFilesCopyCreate = (param: DomainFileChangeReq, params: RequestParams = {}) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/files/copy`,
      method: "POST",
      body: param,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 下载文件
   *
   * @tags 【用户】文件管理
   * @name V1UsersFilesDownloadList
   * @summary 下载文件
   * @request GET:/api/v1/users/files/download
   * @secure
   */
  v1UsersFilesDownloadList = (
    query: {
      /** 虚拟机 id */
      id: string;
      /** 文件/目录路径 */
      path: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/files/download`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 移动文件/目录
   *
   * @tags 【用户】文件管理
   * @name V1UsersFilesMoveUpdate
   * @summary 移动文件/目录
   * @request PUT:/api/v1/users/files/move
   * @secure
   */
  v1UsersFilesMoveUpdate = (param: DomainFileChangeReq, params: RequestParams = {}) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/files/move`,
      method: "PUT",
      body: param,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 保存文件内容
   *
   * @tags 【用户】文件管理
   * @name V1UsersFilesSaveUpdate
   * @summary 保存文件内容
   * @request PUT:/api/v1/users/files/save
   * @secure
   */
  v1UsersFilesSaveUpdate = (param: DomainFileSaveReq, params: RequestParams = {}) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/files/save`,
      method: "PUT",
      body: param,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 上传文件
   *
   * @tags 【用户】文件管理
   * @name V1UsersFilesUploadCreate
   * @summary 上传文件
   * @request POST:/api/v1/users/files/upload
   * @secure
   */
  v1UsersFilesUploadCreate = (
    query: {
      /** 虚拟机 id */
      id: string;
      /** 文件上传的绝对地址 */
      path: string;
    },
    data: {
      /** 文件 */
      file: File;
    },
    params: RequestParams = {},
  ) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/files/upload`,
      method: "POST",
      query: query,
      body: data,
      secure: true,
      type: ContentType.FormData,
      format: "json",
      ...params,
    });
  /**
   * @description 目录列表
   *
   * @tags 【用户】文件管理
   * @name V1UsersFoldersList
   * @summary 目录列表
   * @request GET:/api/v1/users/folders
   * @secure
   */
  v1UsersFoldersList = (
    query: {
      /** 虚拟机 id */
      id: string;
      /** 文件/目录路径 */
      path: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: TypesFile[];
      },
      any
    >({
      path: `/api/v1/users/folders`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建目录
   *
   * @tags 【用户】文件管理
   * @name V1UsersFoldersCreate
   * @summary 创建目录
   * @request POST:/api/v1/users/folders
   * @secure
   */
  v1UsersFoldersCreate = (param: DomainFilePathReq, params: RequestParams = {}) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/folders`,
      method: "POST",
      body: param,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Git Bot 列表
   *
   * @tags 【用户】Git Bot
   * @name V1UsersGitBotsList
   * @summary Git Bot 列表
   * @request GET:/api/v1/users/git-bots
   * @secure
   */
  v1UsersGitBotsList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainListGitBotResp;
      },
      WebResp
    >({
      path: `/api/v1/users/git-bots`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新 Git Bot
   *
   * @tags 【用户】Git Bot
   * @name V1UsersGitBotsUpdate
   * @summary 更新 Git Bot
   * @request PUT:/api/v1/users/git-bots
   * @secure
   */
  v1UsersGitBotsUpdate = (req: DomainUpdateGitBotReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/git-bots`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建 Git Bot
   *
   * @tags 【用户】Git Bot
   * @name V1UsersGitBotsCreate
   * @summary 创建 Git Bot
   * @request POST:/api/v1/users/git-bots
   * @secure
   */
  v1UsersGitBotsCreate = (req: DomainCreateGitBotReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainGitBot;
      },
      WebResp
    >({
      path: `/api/v1/users/git-bots`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 分享 Git Bot
   *
   * @tags 【用户】Git Bot
   * @name V1UsersGitBotsShareCreate
   * @summary 分享 Git Bot
   * @request POST:/api/v1/users/git-bots/share
   * @secure
   */
  v1UsersGitBotsShareCreate = (req: DomainShareGitBotReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/git-bots/share`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description Git Bot 任务列表，支持分页
   *
   * @tags 【用户】Git Bot
   * @name V1UsersGitBotsTasksList
   * @summary Git Bot 任务列表
   * @request GET:/api/v1/users/git-bots/tasks
   * @secure
   */
  v1UsersGitBotsTasksList = (
    query?: {
      /** 指定 Git Bot ID，不传则查全部 */
      id?: string;
      /** 下一页标识 */
      next_token?: string;
      /** 分页 */
      page?: number;
      /** 每页多少条记录 */
      size?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListGitBotTaskResp;
      },
      WebResp
    >({
      path: `/api/v1/users/git-bots/tasks`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除 Git Bot
   *
   * @tags 【用户】Git Bot
   * @name V1UsersGitBotsDelete
   * @summary 删除 Git Bot
   * @request DELETE:/api/v1/users/git-bots/{id}
   * @secure
   */
  v1UsersGitBotsDelete = (id: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/git-bots/${id}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取当前用户的 Git 身份认证列表
   *
   * @tags 【用户】git 身份管理
   * @name V1UsersGitIdentitiesList
   * @summary 列表
   * @request GET:/api/v1/users/git-identities
   * @secure
   */
  v1UsersGitIdentitiesList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainGitIdentity[];
      },
      WebResp
    >({
      path: `/api/v1/users/git-identities`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 添加 Git 身份认证
   *
   * @tags 【用户】git 身份管理
   * @name V1UsersGitIdentitiesCreate
   * @summary 添加
   * @request POST:/api/v1/users/git-identities
   * @secure
   */
  v1UsersGitIdentitiesCreate = (req: DomainAddGitIdentityReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainGitIdentity;
      },
      WebResp
    >({
      path: `/api/v1/users/git-identities`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 根据 Git 身份获取指定仓库的分支列表
   *
   * @tags 【用户】git 身份管理
   * @name V1UsersGitIdentitiesBranchesDetail
   * @summary 获取仓库分支列表
   * @request GET:/api/v1/users/git-identities/{identity_id}/{escaped_repo_full_name}/branches
   * @secure
   */
  v1UsersGitIdentitiesBranchesDetail = (
    identityId: string,
    escapedRepoFullName: string,
    query?: {
      /** 页码（默认1） */
      page?: number;
      /** 每页数量（默认50，最大100） */
      per_page?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainBranch[];
      },
      WebResp
    >({
      path: `/api/v1/users/git-identities/${identityId}/${escapedRepoFullName}/branches`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取单个 Git 身份认证详情
   *
   * @tags 【用户】git 身份管理
   * @name V1UsersGitIdentitiesDetail
   * @summary 详情
   * @request GET:/api/v1/users/git-identities/{id}
   * @secure
   */
  v1UsersGitIdentitiesDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainGitIdentity;
      },
      WebResp
    >({
      path: `/api/v1/users/git-identities/${id}`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新 Git 身份认证
   *
   * @tags 【用户】git 身份管理
   * @name V1UsersGitIdentitiesUpdate
   * @summary 更新
   * @request PUT:/api/v1/users/git-identities/{id}
   * @secure
   */
  v1UsersGitIdentitiesUpdate = (id: string, req: DomainUpdateGitIdentityReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/git-identities/${id}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除 Git 身份认证
   *
   * @tags 【用户】git 身份管理
   * @name V1UsersGitIdentitiesDelete
   * @summary 删除
   * @request DELETE:/api/v1/users/git-identities/{id}
   * @secure
   */
  v1UsersGitIdentitiesDelete = (id: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/git-identities/${id}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取主机列表
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsList
   * @summary 获取主机列表
   * @request GET:/api/v1/users/hosts
   * @secure
   */
  v1UsersHostsList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainHostListResp;
      },
      WebResp
    >({
      path: `/api/v1/users/hosts`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取绑定宿主机命令
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsInstallCommandList
   * @summary 获取绑定宿主机命令
   * @request GET:/api/v1/users/hosts/install-command
   * @secure
   */
  v1UsersHostsInstallCommandList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainInstallCommand;
      },
      any
    >({
      path: `/api/v1/users/hosts/install-command`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 修改虚拟机
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsVmsUpdate
   * @summary 修改虚拟机
   * @request PUT:/api/v1/users/hosts/vms
   * @secure
   */
  v1UsersHostsVmsUpdate = (req: DomainUpdateVMReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainVirtualMachine;
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/vms`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建虚拟机
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsVmsCreate
   * @summary 创建虚拟机
   * @request POST:/api/v1/users/hosts/vms
   * @secure
   */
  v1UsersHostsVmsCreate = (request: DomainCreateVMReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainVirtualMachine;
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/vms`,
      method: "POST",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 通过 WebSocket 加入终端
   *
   * @tags 【用户】终端连接管理
   * @name V1UsersHostsVmsTerminalsJoinList
   * @summary 通过 WebSocket 加入终端
   * @request GET:/api/v1/users/hosts/vms/terminals/join
   * @secure
   */
  v1UsersHostsVmsTerminalsJoinList = (
    query?: {
      col?: number;
      /** 加入终端的密码 */
      password?: string;
      row?: number;
      /** 终端 id, 用于唯一标识一个 session */
      terminal_id?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainShareTerminalResp;
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/vms/terminals/join`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取虚拟机详情
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsVmsDetail
   * @summary 获取虚拟机详情
   * @request GET:/api/v1/users/hosts/vms/{id}
   * @secure
   */
  v1UsersHostsVmsDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainVirtualMachine;
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/vms/${id}`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取虚拟机终端session列表
   *
   * @tags 【用户】终端连接管理
   * @name V1UsersHostsVmsTerminalsDetail
   * @summary 获取虚拟机终端session列表
   * @request GET:/api/v1/users/hosts/vms/{id}/terminals
   * @secure
   */
  v1UsersHostsVmsTerminalsDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTerminal[];
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/vms/${id}/terminals`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 通过 WebSocket 连接到指定虚拟机的终端，支持双向通信 终端输入输出用 Binary: 2 消息格式传递。 用于控制窗口大小用 Text: 1 消息格式传递。控制消息的 JSON 格式如下 ```json {"action": "resize", "data": {"col": 80, "row": 24}} ```
   *
   * @tags 【用户】终端连接管理
   * @name V1UsersHostsVmsTerminalsConnectDetail
   * @summary 连接虚拟机终端
   * @request GET:/api/v1/users/hosts/vms/{id}/terminals/connect
   * @secure
   */
  v1UsersHostsVmsTerminalsConnectDetail = (
    id: string,
    query?: {
      /** 终端ID */
      terminal_id?: string;
      /**
       * 终端列数
       * @default 80
       */
      col?: number;
      /**
       * 终端行数
       * @default 24
       */
      row?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, string | WebResp>({
      path: `/api/v1/users/hosts/vms/${id}/terminals/connect`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description 分享终端
   *
   * @tags 【用户】终端连接管理
   * @name V1UsersHostsVmsTerminalsShareCreate
   * @summary 分享终端
   * @request POST:/api/v1/users/hosts/vms/{id}/terminals/share
   * @secure
   */
  v1UsersHostsVmsTerminalsShareCreate = (id: string, request: DomainShareTerminalReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainShareTerminalResp;
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/vms/${id}/terminals/share`,
      method: "POST",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 关闭虚拟机终端session
   *
   * @tags 【用户】终端连接管理
   * @name V1UsersHostsVmsTerminalsDelete
   * @summary 关闭虚拟机终端session
   * @request DELETE:/api/v1/users/hosts/vms/{id}/terminals/{terminal_id}
   * @secure
   */
  v1UsersHostsVmsTerminalsDelete = (id: string, terminalId: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTerminal[];
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/vms/${id}/terminals/${terminalId}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除虚拟机
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsVmsDelete
   * @summary 删除虚拟机
   * @request DELETE:/api/v1/users/hosts/{host_id}/vms/{id}
   * @secure
   */
  v1UsersHostsVmsDelete = (hostId: string, id: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/hosts/${hostId}/vms/${id}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 为开发环境申请一个端口
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsVmsPortsCreate
   * @summary 申请端口
   * @request POST:/api/v1/users/hosts/{host_id}/vms/{id}/ports
   * @secure
   */
  v1UsersHostsVmsPortsCreate = (hostId: string, id: string, request: DomainApplyPortReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainVMPort;
      },
      WebResp
    >({
      path: `/api/v1/users/hosts/${hostId}/vms/${id}/ports`,
      method: "POST",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 为开发环境回收一个端口
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsVmsPortsDelete
   * @summary 回收端口
   * @request DELETE:/api/v1/users/hosts/{host_id}/vms/{id}/ports/{port}
   * @secure
   */
  v1UsersHostsVmsPortsDelete = (
    hostId: string,
    id: string,
    port: string,
    request: DomainRecyclePortReq,
    params: RequestParams = {},
  ) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/hosts/${hostId}/vms/${id}/ports/${port}`,
      method: "DELETE",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新宿主机
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsUpdate
   * @summary 更新宿主机
   * @request PUT:/api/v1/users/hosts/{id}
   * @secure
   */
  v1UsersHostsUpdate = (id: string, request: DomainUpdateHostReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/hosts/${id}`,
      method: "PUT",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除宿主机
   *
   * @tags 【用户】主机管理
   * @name V1UsersHostsDelete
   * @summary 删除宿主机
   * @request DELETE:/api/v1/users/hosts/{id}
   * @secure
   */
  v1UsersHostsDelete = (id: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/hosts/${id}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取当前登录用户的所有镜像配置
   *
   * @tags 【用户】镜像管理
   * @name V1UsersImagesList
   * @summary 获取当前用户的镜像配置列表
   * @request GET:/api/v1/users/images
   * @secure
   */
  v1UsersImagesList = (
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListImageResp;
      },
      WebResp
    >({
      path: `/api/v1/users/images`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 为当前用户创建新的镜像配置
   *
   * @tags 【用户】镜像管理
   * @name V1UsersImagesCreate
   * @summary 创建镜像配置
   * @request POST:/api/v1/users/images
   * @secure
   */
  v1UsersImagesCreate = (req: DomainCreateImageReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainImage;
      },
      WebResp
    >({
      path: `/api/v1/users/images`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新指定的镜像配置信息
   *
   * @tags 【用户】镜像管理
   * @name V1UsersImagesUpdate
   * @summary 更新镜像配置
   * @request PUT:/api/v1/users/images/{id}
   * @secure
   */
  v1UsersImagesUpdate = (id: string, request: DomainUpdateImageReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainImage;
      },
      WebResp
    >({
      path: `/api/v1/users/images/${id}`,
      method: "PUT",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除指定的镜像配置
   *
   * @tags 【用户】镜像管理
   * @name V1UsersImagesDelete
   * @summary 删除镜像配置
   * @request DELETE:/api/v1/users/images/{id}
   * @secure
   */
  v1UsersImagesDelete = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainDeleteImageReq;
      },
      WebResp
    >({
      path: `/api/v1/users/images/${id}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 重定向到百智云OAuth授权页面进行登录认证
   *
   * @tags 【用户】认证
   * @name V1UsersLoginList
   * @summary 百智云OAuth登录
   * @request GET:/api/v1/users/login
   */
  v1UsersLoginList = (
    query?: {
      /** 登录成功后跳转的页面路径 */
      redirect?: string;
      /** 邀请人ID（可选），新用户注册时用于发放邀请奖励 */
      inviter_id?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<any, string>({
      path: `/api/v1/users/login`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description 清除用户会话，登出系统
   *
   * @tags 【用户】认证
   * @name V1UsersLogoutCreate
   * @summary 用户登出
   * @request POST:/api/v1/users/logout
   */
  v1UsersLogoutCreate = (params: RequestParams = {}) =>
    this.request<Record<string, string>, any>({
      path: `/api/v1/users/logout`,
      method: "POST",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取团队成员列表
   *
   * @tags 【用户】用户
   * @name V1UsersMembersList
   * @summary 获取团队成员列表
   * @request GET:/api/v1/users/members
   * @secure
   */
  v1UsersMembersList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainUser[];
      },
      WebResp
    >({
      path: `/api/v1/users/members`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取当前登录用户的所有模型配置
   *
   * @tags 【用户】模型管理
   * @name V1UsersModelsList
   * @summary 获取当前用户的模型配置列表
   * @request GET:/api/v1/users/models
   * @secure
   */
  v1UsersModelsList = (
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListModelResp;
      },
      WebResp
    >({
      path: `/api/v1/users/models`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 为当前用户创建新的模型配置
   *
   * @tags 【用户】模型管理
   * @name V1UsersModelsCreate
   * @summary 创建模型配置
   * @request POST:/api/v1/users/models
   * @secure
   */
  v1UsersModelsCreate = (req: DomainCreateModelReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainModel;
      },
      WebResp
    >({
      path: `/api/v1/users/models`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 使用提供的配置进行健康检查，不更新数据库
   *
   * @tags 【用户】模型管理
   * @name V1UsersModelsHealthCheckCreate
   * @summary 检查模型健康状态（通过配置）
   * @request POST:/api/v1/users/models/health-check
   * @secure
   */
  v1UsersModelsHealthCheckCreate = (req: DomainCheckByConfigReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainCheckModelResp;
      },
      WebResp
    >({
      path: `/api/v1/users/models/health-check`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取供应商支持的模型列表
   *
   * @tags 【用户】模型管理
   * @name GetProviderModelList
   * @summary 获取供应商支持的模型列表
   * @request GET:/api/v1/users/models/providers
   */
  getProviderModelList = (
    query: {
      api_header?: string;
      api_key: string;
      base_url: string;
      provider:
        | "SiliconFlow"
        | "OpenAI"
        | "Ollama"
        | "DeepSeek"
        | "Moonshot"
        | "AzureOpenAI"
        | "BaiZhiCloud"
        | "Hunyuan"
        | "BaiLian"
        | "Volcengine"
        | "Gemini";
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainGetProviderModelListResp;
      },
      any
    >({
      path: `/api/v1/users/models/providers`,
      method: "GET",
      query: query,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新指定的模型配置信息
   *
   * @tags 【用户】模型管理
   * @name V1UsersModelsUpdate
   * @summary 更新模型配置
   * @request PUT:/api/v1/users/models/{id}
   * @secure
   */
  v1UsersModelsUpdate = (id: string, request: DomainUpdateModelReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/models/${id}`,
      method: "PUT",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除指定的模型配置
   *
   * @tags 【用户】模型管理
   * @name V1UsersModelsDelete
   * @summary 删除模型配置
   * @request DELETE:/api/v1/users/models/{id}
   * @secure
   */
  v1UsersModelsDelete = (id: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/models/${id}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 对指定模型进行健康检查，并更新检查结果到数据库
   *
   * @tags 【用户】模型管理
   * @name V1UsersModelsHealthCheckDetail
   * @summary 检查模型健康状态（通过ID）
   * @request GET:/api/v1/users/models/{id}/health-check
   * @secure
   */
  v1UsersModelsHealthCheckDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainCheckModelResp;
      },
      WebResp
    >({
      path: `/api/v1/users/models/${id}/health-check`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 密码登录
   *
   * @tags 【用户】企业团队成员认证
   * @name V1UsersPasswordLoginCreate
   * @summary 密码登录
   * @request POST:/api/v1/users/password-login
   */
  v1UsersPasswordLoginCreate = (req: DomainTeamLoginReq, params: RequestParams = {}) =>
    this.request<DomainTeamUserInfo, any>({
      path: `/api/v1/users/password-login`,
      method: "POST",
      body: req,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 通过传入的 token 查询账户信息
   *
   * @tags 【用户】密码管理
   * @name V1UsersPasswordsAccountsDetail
   * @summary 通过 token 查询账户信息
   * @request GET:/api/v1/users/passwords/accounts/{token}
   */
  v1UsersPasswordsAccountsDetail = (token: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamUserInfo;
      },
      WebResp
    >({
      path: `/api/v1/users/passwords/accounts/${token}`,
      method: "GET",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 修改当前用户的密码
   *
   * @tags 【用户】认证
   * @name V1UsersPasswordsChangeUpdate
   * @summary 修改密码
   * @request PUT:/api/v1/users/passwords/change
   * @secure
   */
  v1UsersPasswordsChangeUpdate = (req: DomainChangePasswordReq, params: RequestParams = {}) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/passwords/change`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 重置当前用户的密码
   *
   * @tags 【用户】密码管理
   * @name V1UsersPasswordsResetUpdate
   * @summary 重置密码
   * @request PUT:/api/v1/users/passwords/reset
   */
  v1UsersPasswordsResetUpdate = (req: DomainResetUserPasswordReq, params: RequestParams = {}) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/passwords/reset`,
      method: "PUT",
      body: req,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 重置指定用户的密码，并发送重置邮件
   *
   * @tags 【用户】密码管理
   * @name V1UsersPasswordsResetRequestUpdate
   * @summary 发送重置密码邮件
   * @request PUT:/api/v1/users/passwords/reset-request
   */
  v1UsersPasswordsResetRequestUpdate = (req: DomainResetUserPasswordEmailReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/passwords/reset-request`,
      method: "PUT",
      body: req,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 用户可以将普通帖子分享到广场，需要填写 title/content/image/code 内容
   *
   * @tags 【用户】广场
   * @name V1UsersPlaygroundNormalPostsCreate
   * @summary 分享普通帖子到广场
   * @request POST:/api/v1/users/playground-normal-posts
   * @secure
   */
  v1UsersPlaygroundNormalPostsCreate = (request: DomainSharePostReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainSharePostResp;
      },
      WebResp
    >({
      path: `/api/v1/users/playground-normal-posts`,
      method: "POST",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取当前用户分享到广场的帖子，支持游标分页
   *
   * @tags 【用户】广场
   * @name V1UsersPlaygroundPostsList
   * @summary 获取自己的公开 Po 文列表
   * @request GET:/api/v1/users/playground-posts
   * @secure
   */
  v1UsersPlaygroundPostsList = (
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListUserPlaygroundPostResp;
      },
      WebResp
    >({
      path: `/api/v1/users/playground-posts`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 用户可以将任务分享到广场，需要填写 content/image/code 内容
   *
   * @tags 【用户】广场
   * @name V1UsersPlaygroundTaskPostsCreate
   * @summary 分享任务到广场
   * @request POST:/api/v1/users/playground-task-posts/{task_id}
   * @secure
   */
  v1UsersPlaygroundTaskPostsCreate = (taskId: string, request: DomainShareTaskReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainShareTaskResp;
      },
      WebResp
    >({
      path: `/api/v1/users/playground-task-posts/${taskId}`,
      method: "POST",
      body: request,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 项目列表
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsList
   * @summary 项目列表
   * @request GET:/api/v1/users/projects
   * @secure
   */
  v1UsersProjectsList = (
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListProjectResp;
      },
      WebResp
    >({
      path: `/api/v1/users/projects`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建项目
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsCreate
   * @summary 创建项目
   * @request POST:/api/v1/users/projects
   * @secure
   */
  v1UsersProjectsCreate = (req: DomainCreateProjectReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainProject;
      },
      WebResp
    >({
      path: `/api/v1/users/projects`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 项目详情
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsDetail
   * @summary 项目详情
   * @request GET:/api/v1/users/projects/{id}
   * @secure
   */
  v1UsersProjectsDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainProject;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新项目
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsUpdate
   * @summary 更新项目
   * @request PUT:/api/v1/users/projects/{id}
   * @secure
   */
  v1UsersProjectsUpdate = (id: string, req: DomainUpdateProjectReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainProject;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 删除项目
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsDelete
   * @summary 删除项目
   * @request DELETE:/api/v1/users/projects/{id}
   * @secure
   */
  v1UsersProjectsDelete = (id: string, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/projects/${id}`,
      method: "DELETE",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 协作者列表
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsCollaboratorsDetail
   * @summary 协作者列表
   * @request GET:/api/v1/users/projects/{id}/collaborators
   * @secure
   */
  v1UsersProjectsCollaboratorsDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainListCollaboratorsResp;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/collaborators`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 问题列表
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsIssuesDetail
   * @summary 问题列表
   * @request GET:/api/v1/users/projects/{id}/issues
   * @secure
   */
  v1UsersProjectsIssuesDetail = (
    id: string,
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListIssuesResp;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/issues`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建问题
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsIssuesCreate
   * @summary 创建问题
   * @request POST:/api/v1/users/projects/{id}/issues
   * @secure
   */
  v1UsersProjectsIssuesCreate = (id: string, req: DomainCreateIssueReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainProjectIssue;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/issues`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 更新问题
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsIssuesUpdate
   * @summary 更新问题
   * @request PUT:/api/v1/users/projects/{id}/issues/{issue_id}
   * @secure
   */
  v1UsersProjectsIssuesUpdate = (id: string, issueId: string, req: DomainUpdateIssueReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainProjectIssue;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/issues/${issueId}`,
      method: "PUT",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 问题评论列表
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsIssuesCommentsDetail
   * @summary 问题评论列表
   * @request GET:/api/v1/users/projects/{id}/issues/{issue_id}/comments
   * @secure
   */
  v1UsersProjectsIssuesCommentsDetail = (
    id: string,
    issueId: string,
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListIssueCommentsResp;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/issues/${issueId}/comments`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建问题评论
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsIssuesCommentsCreate
   * @summary 创建问题评论
   * @request POST:/api/v1/users/projects/{id}/issues/{issue_id}/comments
   * @secure
   */
  v1UsersProjectsIssuesCommentsCreate = (
    id: string,
    issueId: string,
    req: DomainCreateIssueCommentReq,
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainProjectIssueComment;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/issues/${issueId}/comments`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取项目仓库树
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsTreeDetail
   * @summary 获取项目仓库树
   * @request GET:/api/v1/users/projects/{id}/tree
   * @secure
   */
  v1UsersProjectsTreeDetail = (
    id: string,
    query?: {
      /** 是否递归 */
      recursive?: boolean;
      /** 分支 */
      ref?: string;
      /** 路径 */
      path?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainProjectTreeEntry[];
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/tree`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取项目仓库压缩包
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsTreeArchiveDetail
   * @summary 获取项目仓库压缩包
   * @request GET:/api/v1/users/projects/{id}/tree/archive
   * @secure
   */
  v1UsersProjectsTreeArchiveDetail = (
    id: string,
    query?: {
      /** 分支 */
      ref?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<File, WebResp>({
      path: `/api/v1/users/projects/${id}/tree/archive`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      ...params,
    });
  /**
   * @description 获取项目文件内容
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsTreeBlobDetail
   * @summary 获取项目文件内容
   * @request GET:/api/v1/users/projects/{id}/tree/blob
   * @secure
   */
  v1UsersProjectsTreeBlobDetail = (
    id: string,
    query: {
      /** 文件路径 */
      path: string;
      /** 分支 */
      ref?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainProjectBlob;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/tree/blob`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取项目仓库日志
   *
   * @tags 【用户】项目管理
   * @name V1UsersProjectsTreeLogsDetail
   * @summary 获取项目仓库日志
   * @request GET:/api/v1/users/projects/{id}/tree/logs
   * @secure
   */
  v1UsersProjectsTreeLogsDetail = (
    id: string,
    query?: {
      /** 分支 */
      ref?: string;
      /** 路径 */
      path?: string;
      /** 限制数量 */
      limit?: number;
      /** 偏移量 */
      offset?: number;
      /** 起始 SHA */
      since_sha?: string;
      /** 结束 SHA */
      until_sha?: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainProjectLogs;
      },
      WebResp
    >({
      path: `/api/v1/users/projects/${id}/tree/logs`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 检查当前用户是否已登录，返回认证状态和用户信息
   *
   * @tags 【用户】认证
   * @name V1UsersStatusList
   * @summary 检查用户登录状态
   * @request GET:/api/v1/users/status
   */
  v1UsersStatusList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTeamUserInfo;
      },
      any
    >({
      path: `/api/v1/users/status`,
      method: "GET",
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 获取属于该用户的所有任务，支持游标分页
   *
   * @tags 【用户】任务管理
   * @name V1UsersTasksList
   * @summary 任务列表
   * @request GET:/api/v1/users/tasks
   * @secure
   */
  v1UsersTasksList = (
    query?: {
      /** 游标，首页传空。下一页回传回包中的 cursor */
      cursor?: string;
      /** 页数 */
      limit?: number;
      /** 下一页标识 */
      next_token?: string;
      /** 分页 */
      page?: number;
      project_id?: string;
      /** 每页多少条记录 */
      size?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListTaskResp;
      },
      WebResp
    >({
      path: `/api/v1/users/tasks`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 创建任务
   *
   * @tags 【用户】任务管理
   * @name V1UsersTasksCreate
   * @summary 创建任务
   * @request POST:/api/v1/users/tasks
   * @secure
   */
  v1UsersTasksCreate = (param: DomainCreateTaskReq, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainProjectTask;
      },
      WebResp
    >({
      path: `/api/v1/users/tasks`,
      method: "POST",
      body: param,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 数据格式约定参考 [任务数据流 WebSocket](https://mcai.baizhiyun.vip/swagger#/paths/api-v1-users-tasks-stream/get)
   *
   * @tags 【用户】任务管理
   * @name V1UsersTasksPublicStreamList
   * @summary 公开的任务数据流 WebSocket
   * @request GET:/api/v1/users/tasks/public-stream
   * @secure
   */
  v1UsersTasksPublicStreamList = (
    query: {
      /** 任务 ID */
      id: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/tasks/public-stream`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 上传音频数据进行语音识别，返回Server-Sent Events流式文字结果。响应格式为SSE，每个事件包含event和data字段。
   *
   * @tags 【用户】任务管理
   * @name V1UsersTasksSpeechToTextCreate
   * @summary 语音转文字
   * @request POST:/api/v1/users/tasks/speech-to-text
   * @secure
   */
  v1UsersTasksSpeechToTextCreate = (params: RequestParams = {}) =>
    this.request<DomainSpeechRecognitionEvent, WebResp>({
      path: `/api/v1/users/tasks/speech-to-text`,
      method: "POST",
      secure: true,
      ...params,
    });
  /**
   * @description 停止任务
   *
   * @tags 【用户】任务管理
   * @name V1UsersTasksStopUpdate
   * @summary 停止任务
   * @request PUT:/api/v1/users/tasks/stop
   * @secure
   */
  v1UsersTasksStopUpdate = (
    id: GitInChaitinNetAiMonkeycodeMonkeycodeAiDomainIDReqGithubComGoogleUuidUUID,
    params: RequestParams = {},
  ) =>
    this.request<WebResp, any>({
      path: `/api/v1/users/tasks/stop`,
      method: "PUT",
      body: id,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 功能定位：该接口通过 WebSocket 仅做 Agent ↔ 前端 的数据代理与转发，不进行任何包体解析或改写。所有数据以原始格式透传并存储。<br> 数据格式约定：当前仅支持文本帧透传。服务端将 Agent 的原始文本数据包装为如下结构返回给前端（对应 [domain.TaskStream](domain/task.go:141)）：<br> ```json { "type": "string", "data": "string", "timestamp": 0 } ``` 字段说明：<br> ### type：事件类型 - task-started: 本轮任务启动 - task-ended: 本轮任务结束 - task-error: 本轮任务发生错误 - task-running: 任务正在运行 - task-event: 任务临时事件, 不持久化 - file-change: 文件变动事件 - permission-resp: 用户的权限响应 - auto-approve: 开启自动批准 - disable-auto-approve: 关闭自动批准 - user-input: 用户输入 - user-cancel: 取消当前操作，不会终止任务 - reply-question: 回复 AI 的提问 ```json { "request_id": "xx", "answers_json": "xxx", "cancelled": false } ``` - call: 同步请求 ```repo_file_diff {"task_id":"task_123456","request_id":"req_20260120_0001","path":"internal/task/handler/http/v1/task.go","unified":true,"context_lines":3} ``` ```repo_file_list {"task_id":"task_123456","request_id":"req_20260120_0002","path":"src","glob_pattern":"","include_hidden":false} ``` ```repo_read_file {"task_id":"task_123456","request_id":"req_20260120_0003","path":"pkg/ws/task.go","offset":0,"length":4096} ``` ```repo_file_changes {"request_id":"req_20260120_0003"} ``` ```restart {"request_id":"req_20260120_0003","load_session": true} ``` - call-response: 同步请求响应 ```restart {"request_id":"req_20260120_0003","message": "错误信息","success": true,"session_id":""} ``` ### kind：agent 透传的类型。由前端与 agent 约定 <br> ### data：原始 JSON 字符串（透明透传，不做解析或改写）<br> ### timestamp：事件产生的时间，单位毫秒<br> 行为与生命周期：<br> - 建立连接后，服务端校验会话并与对应任务的 Agent 建立数据通道<br> - Agent 产生的实时数据帧将被原样转发为 {"type": "...", "data": "...", "timestamp": ...} 推送给前端<br>
   *
   * @tags 【用户】任务管理
   * @name V1UsersTasksStreamList
   * @summary 任务数据流 WebSocket
   * @request GET:/api/v1/users/tasks/stream
   * @secure
   */
  v1UsersTasksStreamList = (
    query: {
      /** 任务 ID */
      id: string;
    },
    params: RequestParams = {},
  ) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/tasks/stream`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 任务详情
   *
   * @tags 【用户】任务管理
   * @name V1UsersTasksDetail
   * @summary 任务详情
   * @request GET:/api/v1/users/tasks/{id}
   * @secure
   */
  v1UsersTasksDetail = (id: string, params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainTask;
      },
      WebResp
    >({
      path: `/api/v1/users/tasks/${id}`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 用户钱包
   *
   * @tags 【用户】钱包
   * @name V1UsersWalletList
   * @summary 用户钱包
   * @request GET:/api/v1/users/wallet
   * @secure
   */
  v1UsersWalletList = (params: RequestParams = {}) =>
    this.request<
      WebResp & {
        data?: DomainWallet;
      },
      WebResp
    >({
      path: `/api/v1/users/wallet`,
      method: "GET",
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 兑现兑换码
   *
   * @tags 【用户】钱包
   * @name V1UsersWalletExchangeCreate
   * @summary 兑现兑换码
   * @request POST:/api/v1/users/wallet/exchange
   * @secure
   */
  v1UsersWalletExchangeCreate = (req: DomainExchangeReq, params: RequestParams = {}) =>
    this.request<WebResp, WebResp>({
      path: `/api/v1/users/wallet/exchange`,
      method: "POST",
      body: req,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
  /**
   * @description 交易记录
   *
   * @tags 【用户】钱包
   * @name V1UsersWalletTransactionList
   * @summary 交易记录
   * @request GET:/api/v1/users/wallet/transaction
   * @secure
   */
  v1UsersWalletTransactionList = (
    query?: {
      /** 结束时间戳 */
      end?: number;
      /** 下一页标识 */
      next_token?: string;
      /** 分页 */
      page?: number;
      /** 每页多少条记录 */
      size?: number;
      /** 根据 created_at 排序A；asc/desc；默认为 desc */
      sort?: string;
      /** 开始时间戳 */
      start?: number;
    },
    params: RequestParams = {},
  ) =>
    this.request<
      WebResp & {
        data?: DomainListTransactionResp;
      },
      WebResp
    >({
      path: `/api/v1/users/wallet/transaction`,
      method: "GET",
      query: query,
      secure: true,
      type: ContentType.Json,
      format: "json",
      ...params,
    });
}
