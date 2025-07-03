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
  DomainCategoryStat,
  DomainStatistics,
  DomainTimeStat,
  DomainUserCodeRank,
  DomainUserEvent,
  DomainUserHeatmapResp,
  DomainUserStat,
  GetCategoryStatDashboardParams,
  GetTimeStatDashboardParams,
  GetUserCodeRankDashboardParams,
  GetUserEventsDashboardParams,
  GetUserHeatmapDashboardParams,
  GetUserStatDashboardParams,
  WebResp,
} from "./types";

/**
 * @description 获取分类统计信息
 *
 * @tags Dashboard
 * @name GetCategoryStatDashboard
 * @summary 获取分类统计信息
 * @request GET:/api/v1/dashboard/category-stat
 * @response `200` `(WebResp & {
    data?: DomainCategoryStat,

})` OK
 */

export const getCategoryStatDashboard = (
  query: GetCategoryStatDashboardParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainCategoryStat;
    }
  >({
    path: `/api/v1/dashboard/category-stat`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取统计信息
 *
 * @tags Dashboard
 * @name GetStatisticsDashboard
 * @summary 获取统计信息
 * @request GET:/api/v1/dashboard/statistics
 * @response `200` `(WebResp & {
    data?: DomainStatistics,

})` OK
 */

export const getStatisticsDashboard = (params: RequestParams = {}) =>
  request<
    WebResp & {
      data?: DomainStatistics;
    }
  >({
    path: `/api/v1/dashboard/statistics`,
    method: "GET",
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取时间统计信息
 *
 * @tags Dashboard
 * @name GetTimeStatDashboard
 * @summary 获取时间统计信息
 * @request GET:/api/v1/dashboard/time-stat
 * @response `200` `(WebResp & {
    data?: DomainTimeStat,

})` OK
 */

export const getTimeStatDashboard = (
  query: GetTimeStatDashboardParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainTimeStat;
    }
  >({
    path: `/api/v1/dashboard/time-stat`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 用户贡献榜
 *
 * @tags Dashboard
 * @name GetUserCodeRankDashboard
 * @summary 用户贡献榜
 * @request GET:/api/v1/dashboard/user-code-rank
 * @response `200` `(WebResp & {
    data?: (DomainUserCodeRank)[],

})` OK
 */

export const getUserCodeRankDashboard = (
  query: GetUserCodeRankDashboardParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainUserCodeRank[];
    }
  >({
    path: `/api/v1/dashboard/user-code-rank`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取用户事件
 *
 * @tags Dashboard
 * @name GetUserEventsDashboard
 * @summary 获取用户事件
 * @request GET:/api/v1/dashboard/user-events
 * @response `200` `(WebResp & {
    data?: (DomainUserEvent)[],

})` OK
 */

export const getUserEventsDashboard = (
  query: GetUserEventsDashboardParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainUserEvent[];
    }
  >({
    path: `/api/v1/dashboard/user-events`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 用户热力图
 *
 * @tags Dashboard
 * @name GetUserHeatmapDashboard
 * @summary 用户热力图
 * @request GET:/api/v1/dashboard/user-heatmap
 * @response `200` `(WebResp & {
    data?: DomainUserHeatmapResp,

})` OK
 */

export const getUserHeatmapDashboard = (
  query: GetUserHeatmapDashboardParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainUserHeatmapResp;
    }
  >({
    path: `/api/v1/dashboard/user-heatmap`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });

/**
 * @description 获取用户统计信息
 *
 * @tags Dashboard
 * @name GetUserStatDashboard
 * @summary 获取用户统计信息
 * @request GET:/api/v1/dashboard/user-stat
 * @response `200` `(WebResp & {
    data?: DomainUserStat,

})` OK
 */

export const getUserStatDashboard = (
  query: GetUserStatDashboardParams,
  params: RequestParams = {},
) =>
  request<
    WebResp & {
      data?: DomainUserStat;
    }
  >({
    path: `/api/v1/dashboard/user-stat`,
    method: "GET",
    query: query,
    type: ContentType.Json,
    format: "json",
    ...params,
  });
