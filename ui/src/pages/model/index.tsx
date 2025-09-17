import React, { useEffect, useRef } from 'react';
import TokenUsage from './components/tokenUsage';
import ModelCard from './components/modelCard';
import { Stack } from '@mui/material';
import { GithubComChaitinMonkeyCodeBackendConstsModelType } from '@/api/types';
import { useCommonContext } from '@/hooks/context';
import { Modal } from '@ctzhian/ui';

const Model = () => {
  const { coderModel, llmModel, refreshModel, isConfigModel, modelLoading } =
    useCommonContext();
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current && !isConfigModel && !modelLoading) {
      isFirst.current = false;
      let text = '';
      if (
        (coderModel || []).length === 0 ||
        coderModel.every((it) => !it.is_active)
      ) {
        text = '代码补全模型尚未配置激活，平台功能暂不可用！';
      } else if (
        (llmModel || []).length === 0 ||
        llmModel.every((it) => !it.is_active)
      ) {
        text = '对话模型尚未配置激活，平台功能暂不可用！';
      } else {
        text = '模型尚未配置激活，平台功能暂不可用！';
      }
      Modal.confirm({
        title: '提示',
        content: text,
        showCancel: false,
        okText: '去配置',
      });
    }
  }, [isConfigModel, coderModel, llmModel, modelLoading]);

  return (
    <Stack gap={2}>
      <TokenUsage />
      <ModelCard
        title='对话模型'
        data={llmModel}
        refreshModel={refreshModel}
        modelType={
          GithubComChaitinMonkeyCodeBackendConstsModelType.ModelTypeLLM
        }
      />
      <ModelCard
        title='代码补全模型'
        data={coderModel}
        refreshModel={refreshModel}
        modelType={
          GithubComChaitinMonkeyCodeBackendConstsModelType.ModelTypeCoder
        }
      />
    </Stack>
  );
};

export default Model;
