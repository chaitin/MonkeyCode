import { Button, Radio, Stack, Box, TextField } from '@mui/material';
import { Modal, Icon, message } from '@c-x/ui';
import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { FormItem } from '@/components/form';
import { putUpdateSetting } from '@/api/User';
import { DomainSetting, DomainUpdateSettingReq } from '@/api/types';

type LoginType = 'dingding' | 'wechat' | 'feishu' | 'oauth' | 'none';

// 登录选项配置
const loginOptions = [
  { type: 'none' as LoginType, label: '不启用', disabled: false },
  { type: 'dingding' as LoginType, label: '钉钉登录', disabled: false },
  { type: 'oauth' as LoginType, label: 'OAuth 登录', disabled: false },
  { type: 'wechat' as LoginType, label: '企业微信登录', disabled: true },
  { type: 'feishu' as LoginType, label: '飞书登录', disabled: true },
];

// 登录选项组件
const LoginOptionButton = ({
  option,
  isSelected,
  onSelect,
}: {
  option: (typeof loginOptions)[0];
  isSelected: boolean;
  onSelect: (type: LoginType) => void;
}) => (
  <Button
    variant='outlined'
    color='primary'
    sx={{ gap: 1 }}
    disabled={option.disabled}
    onClick={() => !option.disabled && onSelect(option.type)}
  >
    <Radio
      size='small'
      sx={{ p: 0.5 }}
      checked={isSelected}
      disabled={option.disabled}
    />
    {option.label}
  </Button>
);

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
      custom_oauth_access_token_url: '',
      custom_oauth_authorize_url: '',
      custom_oauth_client_id: '',
      custom_oauth_client_secret: '',
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
      reset(
        {
          dingtalk_client_id: settingData.dingtalk_client_id,
        },
        {
          keepValues: true,
        }
      );
    }
    if (settingData?.enable_custom_oauth) {
      setLoginType('oauth');
      reset(
        {
          custom_oauth_access_token_url:
            settingData.custom_oauth_access_token_url,
          custom_oauth_authorize_url: settingData.custom_oauth_authorize_url,
          custom_oauth_client_id: settingData.custom_oauth_client_id,
        },
        {
          keepValues: true,
        }
      );
    }
  }, [settingData]);

  const onSubmit = handleSubmit((data) => {
    let params: DomainUpdateSettingReq = {};
    if (loginType === 'none') {
      params = {
        enable_dingtalk_oauth: false,
        enable_custom_oauth: false,
      };
    } else if (loginType === 'dingding') {
      params = {
        enable_dingtalk_oauth: true,
        enable_custom_oauth: false,
        dingtalk_client_id: data.dingtalk_client_id,
        dingtalk_client_secret: data.dingtalk_client_secret,
      };
    } else if (loginType === 'oauth') {
      params = {
        enable_custom_oauth: true,
        enable_dingtalk_oauth: false,
        custom_oauth_access_token_url: data.custom_oauth_access_token_url,
        custom_oauth_authorize_url: data.custom_oauth_authorize_url,
        custom_oauth_client_id: data.custom_oauth_client_id,
        custom_oauth_client_secret: data.custom_oauth_client_secret,
      };
    }

    putUpdateSetting(params).then(() => {
      message.success('设置成功');
      onCancel();
      onOk();
    });
  });

  const dingdingForm = () => {
    return (
      <>
        <FormItem label='Client ID' required>
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
        </FormItem>
        <FormItem label='Client Secret' required>
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
        </FormItem>
      </>
    );
  };

  const oauthForm = () => {
    return (
      <>
        <FormItem label='Access Token URL' required>
          <Controller
            control={control}
            rules={{
              required: 'Access Token URL 不能为空',
            }}
            name='custom_oauth_access_token_url'
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.custom_oauth_access_token_url}
                helperText={errors.custom_oauth_access_token_url?.message}
              />
            )}
          />
        </FormItem>
        <FormItem label='Authorize URL' required>
          <Controller
            control={control}
            name='custom_oauth_authorize_url'
            rules={{
              required: 'Authorize URL 不能为空',
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.custom_oauth_authorize_url}
                helperText={errors.custom_oauth_authorize_url?.message}
              />
            )}
          />
        </FormItem>
        <FormItem label='Client ID' required>
          <Controller
            control={control}
            name='custom_oauth_client_id'
            rules={{
              required: 'Client ID 不能为空',
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.custom_oauth_client_id}
                helperText={errors.custom_oauth_client_id?.message}
              />
            )}
          />
        </FormItem>
        <FormItem label='Client Secret' required>
          <Controller
            control={control}
            name='custom_oauth_client_secret'
            rules={{
              required: 'Client Secret 不能为空',
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.custom_oauth_client_secret}
                helperText={errors.custom_oauth_client_secret?.message}
              />
            )}
          />
        </FormItem>
      </>
    );
  };

  return (
    <Modal
      open={open}
      width={800}
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
        {loginOptions.map((option) => (
          <LoginOptionButton
            key={option.type}
            option={option}
            isSelected={loginType === option.type}
            onSelect={setLoginType}
          />
        ))}
      </Stack>
      <Stack gap={2} sx={{ mt: 4 }}>
        {loginType === 'dingding' && dingdingForm()}
        {loginType === 'oauth' && oauthForm()}
      </Stack>
    </Modal>
  );
};

export default ThirdPartyLoginSettingModal;
