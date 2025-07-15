import React from 'react';
import TokenUsage from './components/tokenUsage';
import ModelCard from './components/modelCard';
import { Stack } from '@mui/material';
import { ConstsModelType } from '@/api/types';

const Model = () => {
  return (
    <Stack gap={2}>
      <TokenUsage />
      <ModelCard title='对话模型' modelType={ConstsModelType.ModelTypeLLM} />
      <ModelCard
        title='代码补全模型'
        modelType={ConstsModelType.ModelTypeCoder}
      />
    </Stack>
  );
};

export default Model;
