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
  DomainAllModelResp,
  DomainCheckModelReq,
  DomainCreateModelReq,
  DomainGetProviderModelListResp,
  DomainModel,
  DomainModelTokenUsageResp,
  DomainUpdateModelReq,
  GetGetProviderModelListParams,
  GetGetTokenUsageParams,
  GetMyModelListParams,
  WebResp,
} from "./types";

/**
 * @description 获取模型列表
 *
 * @tags Model
 * @name GetListModel
 * @summary 获取模型列表
 * @request GET:/api/v1/model
 * @response `200` `(WebResp & {
    data?: DomainAllModelResp,

})` OK
 */

export const getListModel = (params: RequestParams = {}) =>
  request<
    WebResp & {
      data?: DomainAllModelResp;
    }
  >({
    path: `/api/v1/model`,
    method: "GET",
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 更新模型
 *
 * @tags Model
 * @name PutUpdateModel
 * @summary 更新模型
 * @request PUT:/api/v1/model
 * @response `200` `(WebResp & {
    data?: DomainModel,

})` OK
 */

export const putUpdateModel = (
  model: DomainUpdateModelReq,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainModel;
    }
  >({
    path: `/api/v1/model`,
    method: "PUT",
    body: model,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 创建模型
 *
 * @tags Model
 * @name PostCreateModel
 * @summary 创建模型
 * @request POST:/api/v1/model
 * @response `200` `(WebResp & {
    data?: DomainModel,

})` OK
 */

export const postCreateModel = (
  model: DomainCreateModelReq,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainModel;
    }
  >({
    path: `/api/v1/model`,
    method: "POST",
    body: model,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 检查模型
 *
 * @tags Model
 * @name PostCheckModel
 * @summary 检查模型
 * @request POST:/api/v1/model/check
 * @response `200` `(WebResp & {
    data?: DomainModel,

})` OK
 */

export const postCheckModel = (
  model: DomainCheckModelReq,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainModel;
    }
  >({
    path: `/api/v1/model/check`,
    method: "POST",
    body: model,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取我的模型列表
 *
 * @tags Model
 * @name GetMyModelList
 * @summary 获取我的模型列表
 * @request GET:/api/v1/model/my
 * @response `200` `(WebResp & {
    data?: (DomainModel)[],

})` OK
 */

export const getMyModelList = (
  query: GetMyModelListParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainModel[];
    }
  >({
    path: `/api/v1/model/my`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取供应商支持的模型列表
 *
 * @tags Model
 * @name GetGetProviderModelList
 * @summary 获取供应商支持的模型列表
 * @request GET:/api/v1/model/provider/supported
 * @response `200` `(WebResp & {
    data?: DomainGetProviderModelListResp,

})` OK
 */

export const getGetProviderModelList = (
  query: GetGetProviderModelListParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainGetProviderModelListResp;
    }
  >({
    path: `/api/v1/model/provider/supported`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取模型token使用情况
 *
 * @tags Model
 * @name GetGetTokenUsage
 * @summary 获取模型token使用情况
 * @request GET:/api/v1/model/token-usage
 * @response `200` `(WebResp & {
    data?: DomainModelTokenUsageResp,

})` OK
 */

export const getGetTokenUsage = (
  query: GetGetTokenUsageParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainModelTokenUsageResp;
    }
  >({
    path: `/api/v1/model/token-usage`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });
