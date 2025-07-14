/* eslint-disable */
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

import request, { ContentType, RequestParams } from "./httpClient";
import {
  DeleteDeleteAdminParams,
  DomainAdminUser,
  DomainCreateAdminReq,
  DomainListAdminLoginHistoryResp,
  DomainListAdminUserResp,
  DomainLoginReq,
  DomainSetting,
  DomainUpdateSettingReq,
  GetAdminLoginHistoryParams,
  GetListAdminUserParams,
  WebResp,
} from "./types";

/**
 * @description 创建管理员
 *
 * @tags Admin
 * @name PostCreateAdmin
 * @summary 创建管理员
 * @request POST:/api/v1/admin/create
 * @response `200` `(WebResp & {
    data?: DomainAdminUser,

})` OK
 */

export const postCreateAdmin = (
  param: DomainCreateAdminReq,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainAdminUser;
    }
  >({
    path: `/api/v1/admin/create`,
    method: "POST",
    body: param,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 删除管理员
 *
 * @tags Admin
 * @name DeleteDeleteAdmin
 * @summary 删除管理员
 * @request DELETE:/api/v1/admin/delete
 * @response `200` `(WebResp & {
    data?: Record<string, any>,

})` OK
 */

export const deleteDeleteAdmin = (
  query: DeleteDeleteAdminParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: Record<string, any>;
    }
  >({
    path: `/api/v1/admin/delete`,
    method: "DELETE",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取管理员用户列表
 *
 * @tags Admin
 * @name GetListAdminUser
 * @summary 获取管理员用户列表
 * @request GET:/api/v1/admin/list
 * @response `200` `(WebResp & {
    data?: DomainListAdminUserResp,

})` OK
 */

export const getListAdminUser = (
  query: GetListAdminUserParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainListAdminUserResp;
    }
  >({
    path: `/api/v1/admin/list`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 管理员登录
 *
 * @tags Admin
 * @name PostAdminLogin
 * @summary 管理员登录
 * @request POST:/api/v1/admin/login
 * @response `200` `(WebResp & {
    data?: DomainAdminUser,

})` OK
 */

export const postAdminLogin = (
  param: DomainLoginReq,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainAdminUser;
    }
  >({
    path: `/api/v1/admin/login`,
    method: "POST",
    body: param,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取管理员登录历史
 *
 * @tags Admin
 * @name GetAdminLoginHistory
 * @summary 获取管理员登录历史
 * @request GET:/api/v1/admin/login-history
 * @response `200` `(WebResp & {
    data?: DomainListAdminLoginHistoryResp,

})` OK
 */

export const getAdminLoginHistory = (
  query: GetAdminLoginHistoryParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainListAdminLoginHistoryResp;
    }
  >({
    path: `/api/v1/admin/login-history`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取系统设置
 *
 * @tags Admin
 * @name GetGetSetting
 * @summary 获取系统设置
 * @request GET:/api/v1/admin/setting
 * @response `200` `(WebResp & {
    data?: DomainSetting,

})` OK
 */

export const getGetSetting = (params: RequestParams = {}) =>
  request<
    WebResp & {
      data?: DomainSetting;
    }
  >({
    path: `/api/v1/admin/setting`,
    method: "GET",
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 更新系统设置
 *
 * @tags Admin
 * @name PutUpdateSetting
 * @summary 更新系统设置
 * @request PUT:/api/v1/admin/setting
 * @response `200` `(WebResp & {
    data?: DomainSetting,

})` OK
 */

export const putUpdateSetting = (
  param: DomainUpdateSettingReq,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainSetting;
    }
  >({
    path: `/api/v1/admin/setting`,
    method: "PUT",
    body: param,
    type: ContentType.Json,
    format: "json",
    ...params,
  });
