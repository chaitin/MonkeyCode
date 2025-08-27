import type {
  ModelService as IModelService,
  CreateModelReq as UICreateModelData,
  UpdateModelReq as UIUpdateModelData,
  CheckModelReq as UICheckModelData,
  ListModelReq as UIGetModelNameData,
  Model,
  ModelListItem as UIModelListItem,
} from '@yokowu/modelkit-ui';
import {
  DomainCreateModelReq as LocalCreateModelData,
  DomainUpdateModelReq as LocalUpdateModelData,
  GithubComChaitinMonkeyCodeBackendDomainCheckModelReq as LocalCheckModelData,
  GetGetProviderModelListParams as LocalGetModelNameData,
  GithubComChaitinMonkeyCodeBackendConstsModelType,
  GithubComChaitinMonkeyCodeBackendConstsModelStatus,
  GithubComChaitinMonkeyCodeBackendConstsModelProvider,
  DomainModel,
} from '@/api/types';
import { getGetProviderModelList, postCheckModel, postCreateModel, putUpdateModel } from '@/api/Model';

const localModelToModelKitModel = (
  localModel: DomainModel,
): Model => {
  return {
    id: localModel.id || '',
    model_name: localModel.model_name || '',
    provider: localModel.provider as GithubComChaitinMonkeyCodeBackendConstsModelProvider,
    model_type: localModel.model_type as GithubComChaitinMonkeyCodeBackendConstsModelType,
    base_url: localModel.api_base || '',
    api_key: localModel.api_key || '',
    api_header: localModel.api_header || '',
    api_version: localModel.api_version || '',
    param: localModel.param || undefined,
    show_name: localModel.show_name || '',
    status: localModel.status as GithubComChaitinMonkeyCodeBackendConstsModelStatus | undefined,
    created_at: localModel.created_at || 0,
    updated_at: localModel.updated_at || 0,
    input: localModel.input || 0,
    output: localModel.output || 0,
    is_active: localModel.is_active || false,
    is_internal: localModel.is_internal || false,
  };
};

const modelkitModelTypeToLocal = (
  modelType: string,
): GithubComChaitinMonkeyCodeBackendConstsModelType => {
  if (modelType === 'coder') return GithubComChaitinMonkeyCodeBackendConstsModelType.ModelTypeCoder;
  if (modelType === 'code') return GithubComChaitinMonkeyCodeBackendConstsModelType.ModelTypeCoder;
  return GithubComChaitinMonkeyCodeBackendConstsModelType.ModelTypeLLM;
};

const modelkitModelTypeToLocalString = (
  modelType: string,
): "llm" | "coder" | "embedding" | "rerank" => {
  if (modelType === 'coder') return 'coder';
  if (modelType === 'code') return 'coder';
  if (modelType === 'embedding') return 'embedding';
  if (modelType === 'reranker') return 'rerank';
  if (modelType === 'rerank') return 'rerank';

  return 'llm';
};

// 转换 UI 创建模型数据为本地创建模型数据
const convertUICreateToLocalCreate = (
  uiModel: UICreateModelData,
): LocalCreateModelData => {
  return {
    model_name: uiModel.model_name || '',
    provider: uiModel.provider as GithubComChaitinMonkeyCodeBackendConstsModelProvider,
    model_type: modelkitModelTypeToLocal(uiModel.model_type || ''),
    api_base: uiModel.base_url || '',
    api_key: uiModel.api_key || '',
    api_header: uiModel.api_header || '',
    param: uiModel.param || undefined,
    show_name: uiModel.show_name || '',
  };
};

// 转换 UI 更新模型数据为本地更新模型数据
const convertUIUpdateToLocalUpdate = (
  uiModel: UIUpdateModelData,
): LocalUpdateModelData => {
  return {
    id: uiModel.id || '',
    model_name: uiModel.model_name || '',
    provider: uiModel.provider as GithubComChaitinMonkeyCodeBackendConstsModelProvider,
    api_base: uiModel.base_url || '',
    api_key: uiModel.api_key || '',
    api_header: uiModel.api_header || '',
    api_version: uiModel.api_version || '',
    param: uiModel.param || undefined,
    show_name: uiModel.show_name || '',
    status: uiModel.status as GithubComChaitinMonkeyCodeBackendConstsModelStatus | undefined,
  };
};

// 转换 UI 检查模型数据为本地检查模型数据
const convertUICheckToLocalCheck = (
  uiCheck: UICheckModelData,
): LocalCheckModelData => {
  return {
    model_name: uiCheck.model_name || '',
    provider: uiCheck.provider as GithubComChaitinMonkeyCodeBackendConstsModelProvider,
    type: modelkitModelTypeToLocalString(uiCheck.model_type || ''),
    api_base: uiCheck.base_url || '',
    api_key: uiCheck.api_key || '',
    api_header: uiCheck.api_header || '',
    api_version: uiCheck.api_version || '',
  };
};

// 转换 UI 获取模型名称数据为本地获取模型名称数据
const convertUIGetModelNameToLocal = (
  uiData: UIGetModelNameData,
): LocalGetModelNameData => {
  return {
    provider: uiData.provider as GithubComChaitinMonkeyCodeBackendConstsModelProvider,
    type: modelkitModelTypeToLocal(uiData.model_type || ''),
    base_url: uiData.base_url || '',
    api_key: uiData.api_key || '',
    api_header: uiData.api_header || '',
  };
};

// ModelService 实现
export const modelService: IModelService = {
  async createModel(data: UICreateModelData) {
    const localData = convertUICreateToLocalCreate(data);
    const result = await postCreateModel(localData);

    // 创建成功后返回模型数据
    const model: Model = result;

    return { model };
  },

  async listModel(data: UIGetModelNameData) {
    const localData = convertUIGetModelNameToLocal(data);
    const result = await getGetProviderModelList(localData);

    const models: UIModelListItem[] = result.models
      ? result.models.map(item => ({
          model: item.model || '',
        }))
      : [];
    const error: string = result.error || '';

    return { models, error };
  },

  async checkModel(data: UICheckModelData) {
    const localData = convertUICheckToLocalCheck(data);
    const result = await postCheckModel(localData);

    const model: Model = result.model || {};
    const error: string = result.error || '';
    return { model, error };
  },

  async updateModel(data: UIUpdateModelData) {
    const localData = convertUIUpdateToLocalUpdate(data);
    const res = await putUpdateModel(localData);

    // 更新成功后返回模型数据
    const model: Model = res;

    return { model };
  },
};

export { modelkitModelTypeToLocal ,localModelToModelKitModel};
