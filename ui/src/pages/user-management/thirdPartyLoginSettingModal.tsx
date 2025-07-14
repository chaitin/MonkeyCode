import {
  Button,
  Radio,
  Stack,
  TextField,
  Autocomplete,
  Chip,
} from '@mui/material';
import { Modal, message } from '@c-x/ui';
import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { FormItem } from '@/components/form';
import { putUpdateSetting } from '@/api/Admin';
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
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      dingtalk_client_id: '',
      dingtalk_client_secret: '',
      access_token_url: '',
      authorize_url: '',
      client_id: '',
      client_secret: '',
      id_field: '',
      name_field: '',
      scopes: [] as string[],
      avatar_field: '',
      userinfo_url: '',
      email_field: '',
    },
  });

  const [loginType, setLoginType] = useState<LoginType>(
    settingData?.dingtalk_oauth?.enable ? 'dingding' : 'none'
  );

  const [scopeInputValue, setScopeInputValue] = useState('');

  const userInfoUrl = watch('userinfo_url');

  useEffect(() => {
    if (open) {
      reset();
    }
  }, [open]);

  useEffect(() => {
    if (settingData?.dingtalk_oauth?.enable) {
      setLoginType('dingding');
      reset(
        {
          dingtalk_client_id: settingData.dingtalk_oauth.client_id,
          dingtalk_client_secret: settingData.dingtalk_oauth.client_secret,
        },
        {
          keepValues: true,
        }
      );
    }
    if (settingData?.custom_oauth?.enable) {
      setLoginType('oauth');
      reset(
        {
          access_token_url: settingData.custom_oauth.access_token_url,
          authorize_url: settingData.custom_oauth.authorize_url,
          client_id: settingData.custom_oauth.client_id,
          id_field: settingData.custom_oauth.id_field,
          name_field: settingData.custom_oauth.name_field,
          scopes: settingData.custom_oauth.scopes || [],
          avatar_field: settingData.custom_oauth.avatar_field,
          userinfo_url: settingData.custom_oauth.userinfo_url,
          email_field: settingData.custom_oauth.email_field,
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
        dingtalk_oauth: {
          enable: false,
        },
        custom_oauth: {
          enable: false,
        },
      };
    } else if (loginType === 'dingding') {
      params = {
        dingtalk_oauth: {
          enable: true,
          client_id: data.dingtalk_client_id,
          client_secret: data.dingtalk_client_secret,
        },
        custom_oauth: {
          enable: false,
        },
      };
    } else if (loginType === 'oauth') {
      params = {
        dingtalk_oauth: {
          enable: false,
        },
        custom_oauth: {
          enable: true,
          access_token_url: data.access_token_url,
          authorize_url: data.authorize_url,
          client_id: data.client_id,
          client_secret: data.client_secret,
          id_field: data.id_field,
          name_field: data.name_field,
          scopes: data.scopes,
          avatar_field: data.avatar_field,
          userinfo_url: data.userinfo_url,
          email_field: data.email_field,
        },
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
            name='access_token_url'
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.access_token_url}
                helperText={errors.access_token_url?.message}
              />
            )}
          />
        </FormItem>
        <FormItem label='Authorize URL' required>
          <Controller
            control={control}
            name='authorize_url'
            rules={{
              required: 'Authorize URL 不能为空',
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.authorize_url}
                helperText={errors.authorize_url?.message}
              />
            )}
          />
        </FormItem>
        <FormItem label='Client ID' required>
          <Controller
            control={control}
            name='client_id'
            rules={{
              required: 'Client ID 不能为空',
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.client_id}
                helperText={errors.client_id?.message}
              />
            )}
          />
        </FormItem>
        <FormItem label='Client Secret' required>
          <Controller
            control={control}
            name='client_secret'
            rules={{
              required: 'Client Secret 不能为空',
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.client_secret}
                helperText={errors.client_secret?.message}
              />
            )}
          />
        </FormItem>

        <FormItem label='Scope' required>
          <Controller
            name='scopes'
            control={control}
            rules={{
              validate: (value) => {
                if (value.length === 0) {
                  return 'Scope 不能为空';
                }
                return true;
              },
            }}
            render={({ field }) => (
              <Autocomplete
                multiple
                id='tags-filled'
                options={[]}
                value={field.value}
                inputValue={scopeInputValue}
                onChange={(_, value) => {
                  field.onChange(value);
                }}
                onInputChange={(_, value) => {
                  setScopeInputValue(value);
                }}
                size='small'
                freeSolo
                renderTags={(value: readonly string[], getTagProps) =>
                  value.map((option: string, index: number) => {
                    const { key, ...tagProps } = getTagProps({ index });
                    const label = `${option}`;
                    return (
                      <Chip
                        key={key}
                        label={label}
                        size='small'
                        {...tagProps}
                      />
                    );
                  })
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    required
                    placeholder='请输入（可多个, 回车键确认）'
                    error={Boolean(errors.scopes)}
                    helperText={errors.scopes?.message as string}
                    onBlur={() => {
                      // 失去焦点时自动添加当前输入的值
                      const trimmedValue = scopeInputValue.trim();
                      if (trimmedValue && !field.value.includes(trimmedValue)) {
                        field.onChange([...field.value, trimmedValue]);
                        // 清空输入框
                        setScopeInputValue('');
                      }
                    }}
                  />
                )}
              />
            )}
          />
        </FormItem>
        <FormItem label='用户信息 URL' required>
          <Controller
            control={control}
            name='userinfo_url'
            rules={{
              required: '用户信息 URL 不能为空',
            }}
            render={({ field }) => (
              <TextField
                {...field}
                fullWidth
                size='small'
                placeholder='请输入'
                error={!!errors.userinfo_url}
                helperText={errors.userinfo_url?.message}
              />
            )}
          />
        </FormItem>
        {userInfoUrl && (
          <>
            <FormItem label='ID 字段' required>
              <Controller
                control={control}
                name='id_field'
                rules={{
                  required: 'ID 字段 不能为空',
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder='请输入'
                    error={!!errors.id_field}
                    helperText={errors.id_field?.message}
                  />
                )}
              />
            </FormItem>
            <FormItem label='用户名字段' required>
              <Controller
                control={control}
                name='name_field'
                rules={{
                  required: '用户名字段不能为空',
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder='请输入'
                    error={!!errors.name_field}
                    helperText={errors.name_field?.message}
                  />
                )}
              />
            </FormItem>
            <FormItem label='头像字段' required>
              <Controller
                control={control}
                name='avatar_field'
                rules={{
                  required: '头像字段不能为空',
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder='请输入'
                    error={!!errors.avatar_field}
                    helperText={errors.avatar_field?.message}
                  />
                )}
              />
            </FormItem>
            <FormItem label='邮箱字段' required>
              <Controller
                control={control}
                name='email_field'
                rules={{
                  required: '邮箱字段不能为空',
                }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder='请输入'
                    error={!!errors.email_field}
                    helperText={errors.email_field?.message}
                  />
                )}
              />
            </FormItem>
          </>
        )}
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
