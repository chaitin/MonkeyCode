import {
  postCreateModel,
  getGetProviderModelList,
  postCheckModel,
  putUpdateModel,
} from '@/api';
import { ConstsModelType, DomainModel } from '@/api/types';
import Card from '@/components/card';
import { ModelProvider } from '@/pages/model/constant';
import {
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  useTheme,
  alpha as addOpacityToColor,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { Icon, message, Modal } from '@c-x/ui';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
interface AddModelProps {
  open: boolean;
  data: DomainModel | null;
  type: ConstsModelType;
  onClose: () => void;
  refresh: () => void;
}

interface AddModelForm {
  provider: keyof typeof ModelProvider;
  model: string;
  base_url: string;
  api_version: string;
  api_key: string;
  api_header_key: string;
  api_header_value: string;
  type: ConstsModelType;
  show_name: string;
  // 高级设置字段
  context_window_size: number;
  max_output_tokens: number;
  enable_r1_params: boolean;
  support_image: boolean;
  support_compute: boolean;
  support_prompt_caching: boolean;
}

const titleMap = {
  [ConstsModelType.ModelTypeLLM]: '对话模型',
  [ConstsModelType.ModelTypeCoder]: '代码补全模型',
  [ConstsModelType.ModelTypeEmbedding]: '向量模型',
  [ConstsModelType.ModelTypeAudio]: '音频模型',
  [ConstsModelType.ModelTypeReranker]: '重排序模型',
};

const ModelAdd = ({
  open,
  onClose,
  refresh,
  data,
  type = ConstsModelType.ModelTypeLLM,
}: AddModelProps) => {
  const theme = useTheme();

  const providers: Record<string, any> = ModelProvider;

  const {
    formState: { errors },
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
  } = useForm<AddModelForm>({
    defaultValues: {
      type,
      provider: 'BaiZhiCloud',
      base_url: providers['BaiZhiCloud'].defaultBaseUrl,
      model: '',
      api_version: '',
      api_key: '',
      api_header_key: '',
      api_header_value: '',
      show_name: '',
      // 高级设置默认值
      context_window_size: 64000,
      max_output_tokens: 8192,
      enable_r1_params: false,
      support_image: false,
      support_compute: false,
      support_prompt_caching: false,
    },
  });

  const providerBrand = watch('provider');

  const [modelUserList, setModelUserList] = useState<{ model: string }[]>([]);

  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [expandAdvanced, setExpandAdvanced] = useState(false);

  const handleReset = () => {
    onClose();
    reset({
      type,
      provider: 'BaiZhiCloud',
      model: '',
      base_url: '',
      api_key: '',
      api_version: '',
      api_header_key: '',
      api_header_value: '',
      // 重置高级设置
      context_window_size: 64000,
      max_output_tokens: 8192,
      enable_r1_params: false,
      support_image: false,
      support_compute: false,
      support_prompt_caching: false,
    });
    setModelUserList([]);
    setSuccess(false);
    setLoading(false);
    setModelLoading(false);
    setError('');
    // 重置高级设置的展开状态
    setExpandAdvanced(false);
    refresh();
  };

  const getModel = (value: AddModelForm) => {
    let header = '';
    if (value.api_header_key && value.api_header_value) {
      header = value.api_header_key + '=' + value.api_header_value;
    }
    setModelLoading(true);
    getGetProviderModelList({
      type,
      api_key: value.api_key,
      base_url: value.base_url,
      provider: value.provider as Exclude<typeof value.provider, 'Other'>,
      api_header: header,
    })
      .then((res) => {
        setModelUserList(
          (res.models || [])
            .filter((item): item is { model: string } => !!item.model)
            .sort((a, b) => a.model!.localeCompare(b.model!))
        );
        if (
          data &&
          (res.models || []).find((it) => it.model === data.model_name)
        ) {
          setValue('model', data.model_name!);
        } else {
          setValue('model', res.models?.[0]?.model || '');
        }
        setSuccess(true);
      })
      .finally(() => {
        setModelLoading(false);
      });
  };

  const onSubmit = (value: AddModelForm) => {
    let header = '';
    if (value.api_header_key && value.api_header_value) {
      header = value.api_header_key + '=' + value.api_header_value;
    }
    setError('');
    setLoading(true);
    postCheckModel({
      // @ts-ignore
      type,
      api_key: value.api_key,
      api_base: value.base_url,
      api_version: value.api_version,
      // @ts-ignore
      provider: value.provider,
      model_name: value.model,
      api_header: header,
    })
      .then((res) => {
        if (data) {
          putUpdateModel({
            api_key: value.api_key,
            api_base: value.base_url,
            model_name: value.model,
            api_header: header,
            api_version: value.api_version,
            id: data.id,
            provider: value.provider as Exclude<typeof value.provider, 'Other'>,
            show_name: value.show_name,
            // 添加高级设置字段到 param 对象中
            param: {
              context_window: value.context_window_size,
              max_tokens: value.max_output_tokens,
              r1_enabled: value.enable_r1_params,
              support_images: value.support_image,
              support_computer_use: value.support_compute,
              support_prompt_cache: value.support_prompt_caching,
            },
          })
            .then(() => {
              message.success('修改成功');
              handleReset();
            })
            .finally(() => {
              setLoading(false);
            });
        } else {
          postCreateModel({
            model_type: type,
            api_key: value.api_key,
            api_base: value.base_url,
            model_name: value.model,
            api_header: header,
            provider: value.provider as Exclude<typeof value.provider, 'Other'>,
            show_name: value.show_name,
            // 添加高级设置字段到 param 对象中
            param: {
              context_window: value.context_window_size,
              max_tokens: value.max_output_tokens,
              r1_enabled: value.enable_r1_params,
              support_images: value.support_image,
              support_computer_use: value.support_compute,
              support_prompt_cache: value.support_prompt_caching,
            },
          })
            .then(() => {
              message.success('添加成功');
              handleReset();
            })
            .finally(() => {
              setLoading(false);
            });
        }
      })
      .catch(() => {
        setLoading(false);
      });
  };

  const resetCurData = (value: DomainModel) => {
    // @ts-ignore
    if (value.provider && value.provider !== 'Other') {
      getModel({
        api_key: value.api_key || '',
        base_url: value.api_base || '',
        model: value.model_name || '',
        provider: value.provider,
        api_version: value.api_version || '',
        api_header_key: value.api_header?.split('=')[0] || '',
        api_header_value: value.api_header?.split('=')[1] || '',
        type,
        show_name: value.show_name || '',
        context_window_size: 64000,
        max_output_tokens: 8192,
        enable_r1_params: false,
        support_image: false,
        support_compute: false,
        support_prompt_caching: false
      });
    }
    reset({
      type,
      provider: value.provider || 'Other',
      model: value.model_name || '',
      base_url: value.api_base || '',
      api_key: value.api_key || '',
      api_version: value.api_version || '',
      api_header_key: value.api_header?.split('=')[0] || '',
      api_header_value: value.api_header?.split('=')[1] || '',
      show_name: value.show_name || '',
      context_window_size: value.param?.context_window || 64000,
      max_output_tokens: value.param?.max_tokens || 8192,
      enable_r1_params: value.param?.r1_enabled || false,
      support_image: value.param?.support_images || false,
      support_compute: value.param?.support_computer_use || false,
      support_prompt_caching: value.param?.support_prompt_cache || false
    });
  };

  useEffect(() => {
    if (open) {
      if (data) {
        console.log(data);
        resetCurData(data);
      } else {
        reset({
          type,
          provider: 'BaiZhiCloud',
          model: '',
          base_url: providers['BaiZhiCloud'].defaultBaseUrl,
          api_key: '',
          api_version: '',
          api_header_key: '',
          api_header_value: '',
          show_name: '',
          // 高级设置默认值
          context_window_size: 64000,
          max_output_tokens: 8192,
          enable_r1_params: false,
          support_image: false,
          support_compute: false,
          support_prompt_caching: false,
        });
      }
      // 确保每次打开时高级设置都是折叠的
      setExpandAdvanced(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, open]);

  return (
    <Modal
      title={data ? `修改${titleMap[type]}` : `添加${titleMap[type]}`}
      open={open}
      width={800}
      onCancel={handleReset}
      okText='保存'
      onOk={handleSubmit(onSubmit)}
      okButtonProps={{
        loading,
        disabled: !success && providerBrand !== 'Other',
      }}
    >
      <Stack direction={'row'} alignItems={'stretch'} gap={3}>
        <Stack
          gap={1}
          sx={{
            width: 200,
            flexShrink: 0,
            bgcolor: 'background.paper2',
            borderRadius: '10px',
            p: 1,
          }}
        >
          <Box
            sx={{ fontSize: 14, lineHeight: '24px', fontWeight: 'bold', p: 1 }}
          >
            模型供应商
          </Box>
          {Object.values(providers).map((it) => (
            <Stack
              direction={'row'}
              alignItems={'center'}
              gap={1.5}
              key={it.label}
              sx={{
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: '24px',
                p: 1,
                borderRadius: '10px',
                fontWeight: 'bold',
                fontFamily: 'Gbold',
                ...(providerBrand === it.label && {
                  bgcolor: addOpacityToColor(theme.palette.primary.main, 0.1),
                  color: 'primary.main',
                }),
                '&:hover': {
                  color: 'primary.main',
                },
              }}
              onClick={() => {
                if (data && data.provider === it.label) {
                  resetCurData(data);
                } else {
                  setModelUserList([]);
                  setError('');
                  setModelLoading(false);
                  setSuccess(false);
                  reset({
                    provider: it.label as keyof typeof ModelProvider,
                    base_url:
                      it.label === 'AzureOpenAI' ? '' : it.defaultBaseUrl,
                    model: '',
                    api_version: '',
                    api_key: '',
                    api_header_key: '',
                    api_header_value: '',
                    show_name: '',
                    // 重置高级设置
                    context_window_size: 64000,
                    max_output_tokens: 8192,
                    enable_r1_params: false,
                    support_image: false,
                    support_compute: false,
                    support_prompt_caching: false,
                  });
                }
              }}
            >
              <Icon type={it.icon} sx={{ fontSize: 18 }} />
              {it.cn || it.label || '其他'}
            </Stack>
          ))}
        </Stack>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ fontSize: 14, lineHeight: '32px' }}>
            API 地址{' '}
            <Box component={'span'} sx={{ color: 'red' }}>
              *
            </Box>
          </Box>
          <Controller
            control={control}
            name='base_url'
            rules={{
              required: {
                value: true,
                message: 'URL 不能为空',
              },
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                disabled={!providers[providerBrand].urlWrite}
                size='small'
                placeholder={providers[providerBrand].defaultBaseUrl}
                error={!!errors.base_url}
                helperText={errors.base_url?.message}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  setModelUserList([]);
                  setValue('model', '');
                  setSuccess(false);
                }}
              />
            )}
          />
          <Stack
            direction={'row'}
            alignItems={'center'}
            justifyContent={'space-between'}
            sx={{ fontSize: 14, lineHeight: '32px', mt: 2 }}
          >
            <Box>
              API Secret
              {providers[providerBrand].secretRequired && (
                <Box component={'span'} sx={{ color: 'red' }}>
                  {' '}
                  *
                </Box>
              )}
            </Box>
            {providers[providerBrand].modelDocumentUrl && (
              <Box
                component={'span'}
                sx={{
                  color: 'info.main',
                  cursor: 'pointer',
                  ml: 1,
                  textAlign: 'right',
                }}
                onClick={() =>
                  window.open(
                    providers[providerBrand].modelDocumentUrl,
                    '_blank'
                  )
                }
              >
                查看文档
              </Box>
            )}
          </Stack>
          <Controller
            control={control}
            name='api_key'
            rules={{
              required: {
                value: providers[providerBrand].secretRequired,
                message: 'API Secret 不能为空',
              },
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder=''
                error={!!errors.api_key}
                helperText={errors.api_key?.message}
                onChange={(e) => {
                  field.onChange(e.target.value);
                  setModelUserList([]);
                  setValue('model', '');
                  setSuccess(false);
                }}
              />
            )}
          />
          {(modelUserList.length !== 0 || providerBrand === 'Other') && (
            <>
              <Box sx={{ fontSize: 14, lineHeight: '32px', mt: 2 }}>
                模型备注
                <Box component={'span'} sx={{ color: 'red' }}>
                  *
                </Box>
              </Box>
              <Controller
                control={control}
                name='show_name'
                rules={{
                  required: {
                    value: true,
                    message: '模型备注不能为空',
                  },
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder=''
                    error={!!errors.show_name}
                    helperText={errors.show_name?.message}
                  />
                )}
              />
            </>
          )}
          {providerBrand === 'AzureOpenAI' && (
            <>
              <Box sx={{ fontSize: 14, lineHeight: '32px', mt: 2 }}>
                API Version
              </Box>
              <Controller
                control={control}
                name='api_version'
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder='2024-10-21'
                    error={!!errors.api_version}
                    helperText={errors.api_version?.message}
                    onChange={(e) => {
                      field.onChange(e.target.value);
                      setModelUserList([]);
                      setValue('model', '');
                      setSuccess(false);
                    }}
                  />
                )}
              />
            </>
          )}
          {providerBrand === 'Other' ? (
            <>
              <Box sx={{ fontSize: 14, lineHeight: '32px', mt: 2 }}>
                模型名称{' '}
                <Box component={'span'} sx={{ color: 'red' }}>
                  *
                </Box>
              </Box>
              <Controller
                control={control}
                name='model'
                rules={{
                  required: '模型名称不能为空',
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder=''
                    error={!!errors.model}
                    helperText={errors.model?.message}
                  />
                )}
              />
              <Box sx={{ fontSize: 12, color: 'error.main', mt: 1 }}>
                需要与模型供应商提供的名称完全一致，不要随便填写
              </Box>
            </>
          ) : modelUserList.length === 0 ? (
            <Button
              fullWidth
              variant='outlined'
              loading={modelLoading}
              sx={{ mt: 4 }}
              onClick={handleSubmit(getModel)}
            >
              获取模型列表
            </Button>
          ) : (
            <>
              <Box sx={{ fontSize: 14, lineHeight: '32px', mt: 2 }}>
                模型名称{' '}
                <Box component={'span'} sx={{ color: 'red' }}>
                  *
                </Box>
              </Box>
              <Controller
                control={control}
                name='model'
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    select
                    size='small'
                    placeholder=''
                    error={!!errors.model}
                    helperText={errors.model?.message}
                  >
                    {modelUserList.map((it) => (
                      <MenuItem key={it.model} value={it.model}>
                        {it.model}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              {providers[providerBrand].customHeader && (
                <>
                  <Box sx={{ fontSize: 14, lineHeight: '32px', mt: 2 }}>
                    Header
                  </Box>
                  <Stack direction={'row'} gap={1}>
                    <Controller
                      control={control}
                      name='api_header_key'
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          size='small'
                          placeholder='key'
                          error={!!errors.api_header_key}
                          helperText={errors.api_header_key?.message}
                        />
                      )}
                    />
                    <Box sx={{ fontSize: 14, lineHeight: '36px' }}>=</Box>
                    <Controller
                      control={control}
                      name='api_header_value'
                      render={({ field }) => (
                        <TextField
                          {...field}
                          fullWidth
                          size='small'
                          placeholder='value'
                          error={!!errors.api_header_value}
                          helperText={errors.api_header_value?.message}
                        />
                      )}
                    />
                  </Stack>
                </>
              )}
              
              {/* 高级设置部分 */}
              <Box sx={{ mt: 2 }}>
                <Accordion 
                  sx={{ 
                    boxShadow: 'none',
                    bgcolor: 'transparent',
                    '&:before': {
                      display: 'none',
                    },
                    '& .MuiAccordionSummary-root': {
                      padding: 0,
                      minHeight: 'auto',
                      '& .MuiAccordionSummary-content': {
                        margin: 0,
                      },
                    },
                    '& .MuiAccordionDetails-root': {
                      padding: 0,
                      paddingTop: 1.5,
                    },
                  }}
                  expanded={expandAdvanced}
                  onChange={() => setExpandAdvanced(!expandAdvanced)}
                >
                  <AccordionSummary
                    sx={{ 
                      fontSize: 14, 
                      fontWeight: 500,
                      lineHeight: '32px',
                      color: 'blue',
                      display: 'flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      '&:hover': {
                        opacity: 0.8,
                      },
                    }}
                  >
                    高级设置
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      <Box>
                        <Box sx={{ fontSize: 14, lineHeight: '32px' }}>
                          上下文窗口大小
                        </Box>
                        <Controller
                          control={control}
                          name='context_window_size'
                          render={({ field }) => (
                            <>
                              <TextField
                                {...field}
                                fullWidth
                                size='small'
                                placeholder='例如：16000'
                                type='number'
                                onChange={(e) => field.onChange(Number(e.target.value))}
                              />
                              <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                                {[
                                  { label: '128k', value: 128000 },
                                  { label: '256k', value: 256000 },
                                  { label: '512k', value: 512000 },
                                  { label: '1m', value: 1_000_000 }
                                ].map((option) => (
                                  <Box 
                                    key={option.label}
                                    sx={{ 
                                      fontSize: 12, 
                                      color: 'blue',
                                      cursor: 'pointer',
                                      padding: '2px 4px',
                                      '&:hover': {
                                        textDecoration: 'underline'
                                      }
                                    }}
                                    onClick={() => field.onChange(option.value)}
                                  >
                                    {option.label}
                                  </Box>
                                ))}
                              </Box>
                            </>
                          )}
                        />
                      </Box>
                      
                      <Box>
                        <Box sx={{ fontSize: 14, lineHeight: '32px' }}>
                          最大输出 Token
                        </Box>
                        <Controller
                          control={control}
                          name='max_output_tokens'
                          render={({ field }) => (
                            <TextField
                              {...field}
                              fullWidth
                              size='small'
                              placeholder='例如：4000'
                              type='number'
                              onChange={(e) => field.onChange(Number(e.target.value))}
                            />
                          )}
                        />
                      </Box>
                      
                      {/* 复选框组 - 使用更紧凑的布局 */}
                      <Stack spacing={0}>
                        <Controller
                          control={control}
                          name='enable_r1_params'
                          render={({ field }) => (
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={field.value}
                                  onChange={(e) => field.onChange(e.target.checked)}
                                  size='small'
                                />
                              }
                              label={
                                <Box sx={{ fontSize: 12 }}>
                                  启用 R1 模型参数
                                  <Box component="span" sx={{ ml: 1, color: 'text.secondary', fontSize: 11 }}>
                                    (使用 QWQ 等 R1 系列模型时必须启用，避免出现 400 错误)
                                  </Box>
                                </Box>
                              }
                              sx={{ margin: 0 }}
                            />
                          )}
                        />
                      </Stack>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Box>
            </>
          )}
          {error && (
            <Card
              sx={{
                color: 'error.main',
                mt: 2,
                fontSize: 12,
                p: 2,
                bgcolor: 'background.paper2',
                border: '1px solid',
                borderColor: 'error.main',
              }}
            >
              {error}
            </Card>
          )}
        </Box>
      </Stack>
    </Modal>
  );
};

export default ModelAdd;
