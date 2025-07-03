import { Button, Radio, Stack, Box, TextField } from '@mui/material';
import { Modal, Icon, message } from '@c-x/ui';
import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { StyledFormLabel } from '@/components/form';
import { putUpdateSetting } from '@/api/User';
import { DomainSetting } from '@/api/types';

type LoginType = 'dingding' | 'wechat' | 'feishu' | 'oauth' | 'none';

const ThirdPartyLoginSettingModal = ({
  open,
  onCancel,
  settingData,
  onOk,
}: {
  open: boolean;
  onCancel: () => void;
  settingData: DomainSetting;
  onOk: () => void;
}) => {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      dingtalk_client_id: '',
      dingtalk_client_secret: '',
      // title: '',
    },
  });

  const [loginType, setLoginType] = useState<LoginType>(
    settingData?.enable_dingtalk_oauth ? 'dingding' : 'none'
  );

  useEffect(() => {
    if (open) {
      reset();
    }
  }, [open]);

  useEffect(() => {
    if (settingData?.enable_dingtalk_oauth) {
      setLoginType('dingding');
    }
  }, [settingData]);

  const onSubmit = handleSubmit((data) => {
    if (loginType === 'none') {
      putUpdateSetting({ ...data, enable_dingtalk_oauth: false }).then(() => {
        message.success('设置成功');
        onCancel();
        onOk();
      });
    }
    if (loginType === 'dingding') {
      putUpdateSetting({ ...data, enable_dingtalk_oauth: true }).then(() => {
        message.success('设置成功');
        onCancel();
        onOk();
      });
    }
  });

  return (
    <Modal
      open={open}
      width={900}
      onCancel={onCancel}
      title='第三方登录配置'
      onOk={onSubmit}
    >
      <Stack
        direction='row'
        alignItems='center'
        spacing={2}
        sx={{ mt: 2, height: 'calc(100% - 40px)' }}
      >
        <Button
          variant='outlined'
          color='primary'
          sx={{ gap: 2 }}
          onClick={() => {
            setLoginType('none');
          }}
        >
          <Radio size='small' sx={{ p: 0.5 }} checked={loginType === 'none'} />
          <Stack direction='row' alignItems='center' gap={2}>
            <Stack direction='row' alignItems='center' gap={1}>
              不启用
            </Stack>
          </Stack>
        </Button>
        <Button
          variant='outlined'
          color='primary'
          sx={{ gap: 2 }}
          onClick={() => {
            setLoginType('dingding');
          }}
        >
          <Radio
            size='small'
            sx={{ p: 0.5 }}
            checked={loginType === 'dingding'}
          />
          <Stack direction='row' alignItems='center' gap={2}>
            <Stack direction='row' alignItems='center' gap={1}>
              钉钉登录
            </Stack>
          </Stack>
        </Button>
        <Button variant='outlined' color='primary' sx={{ gap: 2 }} disabled>
          <Radio size='small' sx={{ p: 0.5 }} disabled />
          <Stack direction='row' alignItems='center' gap={2}>
            <Stack direction='row' alignItems='center' gap={1}>
              企业微信登录
            </Stack>
          </Stack>
        </Button>
        <Button variant='outlined' color='primary' sx={{ gap: 2 }} disabled>
          <Radio size='small' sx={{ p: 0.5 }} disabled />
          <Stack direction='row' alignItems='center' gap={2}>
            <Stack direction='row' alignItems='center' gap={1}>
              飞书登录
            </Stack>
          </Stack>
        </Button>
        <Button variant='outlined' color='primary' sx={{ gap: 2 }} disabled>
          <Radio size='small' sx={{ p: 0.5 }} disabled />
          <Stack direction='row' alignItems='center' gap={2}>
            <Stack direction='row' alignItems='center' gap={1}>
              OAuth 登录
            </Stack>
          </Stack>
        </Button>
      </Stack>
      {loginType === 'dingding' && (
        <Stack gap={2} sx={{ mt: 4 }}>
          <Box>
            <StyledFormLabel required>Client ID</StyledFormLabel>
            <Controller
              control={control}
              name='dingtalk_client_id'
              rules={{
                required: {
                  value: true,
                  message: 'Client Id 不能为空',
                },
              }}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  size='small'
                  placeholder='请输入'
                  error={!!errors.dingtalk_client_id}
                  helperText={errors.dingtalk_client_id?.message}
                />
              )}
            />
          </Box>
          <Box>
            <StyledFormLabel required>Client Secret</StyledFormLabel>
            <Controller
              control={control}
              name='dingtalk_client_secret'
              rules={{
                required: {
                  value: true,
                  message: 'Client Secret 不能为空',
                },
              }}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  size='small'
                  placeholder='请输入'
                  error={!!errors.dingtalk_client_secret}
                  helperText={errors.dingtalk_client_secret?.message}
                />
              )}
            />
          </Box>
          {/* <Box>
          <StyledFormLabel>标题名称，默认为 身份认证-钉钉登录</StyledFormLabel>
          <Controller
            control={control}
            name='title'
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.title}
                helperText={errors.title?.message}
                onChange={(e) => {
                  field.onChange(e.target.value);
                }}
              />
            )}
          />
        </Box> */}
        </Stack>
      )}
    </Modal>
  );
};

export default ThirdPartyLoginSettingModal;
