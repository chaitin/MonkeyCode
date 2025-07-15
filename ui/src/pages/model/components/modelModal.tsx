import {
  postCreateModel,
  putUpdateModel,
  postCheckModel,
  getListModel,
} from '@/api/Model';
import Card from '@/components/card';
import { ModelProvider } from '../constant';
import { Icon, message, Modal } from '@c-x/ui';
import { FormItem, StyledFormLabel } from '@/components/form';
import {
  Box,
  MenuItem,
  Stack,
  TextField,
  useTheme,
  alpha,
  Button,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ConstsModelType,
  DomainUpdateModelReq,
  DomainCreateModelReq,
  DomainProviderModel,
} from '@/api/types';

type ModelItem = any;

interface AddModelProps {
  open: boolean;
  data?: ModelItem;
  onClose: () => void;
  refresh: () => void;
  modelType: 'llm' | 'coder';
}

const ModelModal = ({
  open,
  onClose,
  refresh,
  data,
  modelType,
}: AddModelProps) => {
  const theme = useTheme();
  const {
    formState: { errors },
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
  } = useForm<Required<DomainCreateModelReq>>({
    defaultValues: {
      provider: data?.provider || 'DeepSeek',
      api_base: data?.api_base || ModelProvider.DeepSeek.defaultBaseUrl,
      model_name: data?.model_name || '',
      api_key: data?.api_key || '',
    },
  });

  const providerBrand = watch('provider') as keyof typeof ModelProvider;

  const [modelUserList, setModelUserList] = useState<DomainProviderModel[]>([]);

  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [error, setError] = useState('');

  const onCreateModel = (value: DomainCreateModelReq) => {
    return postCreateModel({
      ...value,
      model_type: modelType as ConstsModelType,
    }).then(() => {
      message.success('添加成功');
      reset();
      onClose();
      refresh();
    });
  };

  const onUpdateModel = (value: DomainUpdateModelReq) => {
    return putUpdateModel({
      ...value,
    }).then(() => {
      message.success('修改成功');
      reset();
      onClose();
      refresh();
    });
  };

  const onSubmit = (value: Required<DomainCreateModelReq>) => {
    setError('');
    setLoading(true);
    postCheckModel({
      ...value,
    })
      .then((res) => {
        if (data) {
          onUpdateModel({
            ...value,
            id: data.id,
          }).finally(() => {
            setLoading(false);
          });
        } else {
          onCreateModel(value).finally(() => {
            setLoading(false);
          });
        }
      })
      .catch(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (open) {
      if (data) {
        reset(
          {
            provider: data.provider || 'Other',
            model_name: data.model_name || '',
            api_base: data.api_base || '',
            api_key: data.api_key || '',
          },
          {
            keepDefaultValues: true,
          }
        );
      } else {
        reset();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, open]);

  useEffect(() => {
    if (open) {
      getListModel().then((res) => {
        setModelUserList(res.providers || []);
        if (!data) {
          setValue('provider', res.providers?.[0].provider || 'DeepSeek');
        }
      });
    }
  }, [open]);

  const currentModelList = useMemo(() => {
    return (
      modelUserList.find((it) => it.provider === providerBrand)?.models || []
    );
  }, [modelUserList, providerBrand]);

  useEffect(() => {
    if (currentModelList.length > 0) {
      if (data) {
        setValue('api_base', data.api_base || '');
        setValue('model_name', data.model_name || '');
      } else {
        setValue('api_base', currentModelList[0].api_base || '');
        setValue('model_name', currentModelList[0].name || '');
      }
    }
  }, [currentModelList, data]);

  const getModelList = () => {
    setModelLoading(true);
    getListModel().then((res) => {
      setModelUserList(res.providers || []);
    });
  };

  return (
    <Modal
      title={data ? '修改第三方模型' : '添加第三方模型'}
      open={open}
      width={800}
      onCancel={() => {
        reset();
        setModelUserList([]);
        setLoading(false);
        setError('');
        onClose();
      }}
      okText='保存'
      onOk={handleSubmit(onSubmit)}
      okButtonProps={{
        loading,
      }}
    >
      <Stack direction={'row'} alignItems={'stretch'} gap={3}>
        <Stack
          gap={1}
          sx={{
            width: 200,
            flexShrink: 0,
            bgcolor: 'rgb(248, 249, 250)',
            borderRadius: '10px',
            p: 1,
          }}
        >
          <Box
            sx={{ fontSize: 14, lineHeight: '24px', fontWeight: 'bold', p: 1 }}
          >
            模型供应商
          </Box>
          {modelUserList.map((it) => (
            <Stack
              direction={'row'}
              alignItems={'center'}
              gap={1.5}
              key={it.provider}
              sx={{
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: '24px',
                p: 1,
                borderRadius: '10px',
                fontWeight: 'bold',
                fontFamily: 'Gbold',
                ...(providerBrand === it.provider && {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: 'primary.main',
                }),
                '&:hover': {
                  color: 'primary.main',
                },
              }}
              onClick={() => {
                if (data) return;
                setError('');
                reset(
                  {
                    provider: it.provider as keyof typeof ModelProvider,
                    api_base: '',
                    model_name: '',
                    api_key: '',
                  },
                  {
                    keepDefaultValues: true,
                  }
                );
              }}
            >
              <Icon
                type={
                  ModelProvider[it.provider as keyof typeof ModelProvider].icon
                }
                sx={{ fontSize: 18 }}
              />
              {it.provider}
            </Stack>
          ))}
        </Stack>
        <Stack sx={{ flex: 1 }} gap={2}>
          <FormItem required label='API 地址'>
            <Controller
              control={control}
              name='api_base'
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
                  disabled={!ModelProvider[providerBrand].urlWrite}
                  size='small'
                  placeholder={ModelProvider[providerBrand].defaultBaseUrl}
                  error={!!errors.api_base}
                  helperText={errors.api_base?.message}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    setModelUserList([]);
                    setValue('model_name', '');
                  }}
                />
              )}
            />
          </FormItem>
          <Box>
            <Stack
              direction={'row'}
              alignItems={'center'}
              justifyContent={'space-between'}
            >
              <StyledFormLabel
                required={ModelProvider[providerBrand].secretRequired}
              >
                API Secret
              </StyledFormLabel>
              {ModelProvider[providerBrand].modelDocumentUrl && (
                <Box
                  component={'span'}
                  sx={{
                    color: 'info.main',
                    cursor: 'pointer',
                    ml: 1,
                    textAlign: 'right',
                    fontSize: 14,
                  }}
                  onClick={() =>
                    window.open(
                      ModelProvider[providerBrand].modelDocumentUrl,
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
                  value: ModelProvider[providerBrand].secretRequired,
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
                  }}
                />
              )}
            />
          </Box>

          <Button
            fullWidth
            variant='outlined'
            loading={modelLoading}
            sx={{ mt: 4 }}
            onClick={handleSubmit(getModelList)}
          >
            获取模型列表
          </Button>

          <FormItem required label='模型名称'>
            <Controller
              control={control}
              name='model_name'
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  select
                  size='small'
                  placeholder=''
                  error={!!errors.model_name}
                  helperText={errors.model_name?.message}
                >
                  {currentModelList.map((it) => (
                    <MenuItem key={it.name} value={it.name}>
                      {it.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </FormItem>

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
        </Stack>
      </Stack>
    </Modal>
  );
};

export default ModelModal;
