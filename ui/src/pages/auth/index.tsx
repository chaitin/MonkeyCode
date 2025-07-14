import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Logo from '@/assets/images/logo.png';
import {
  Box,
  Button,
  TextField,
  Typography,
  Container,
  Paper,
  Alert,
  CircularProgress,
  Grid2 as Grid,
  InputAdornment,
  IconButton,
  Divider,
  Stack,
} from '@mui/material';
import { Icon, message } from '@c-x/ui';

// @ts-ignore
import { AestheticFluidBg } from '@/assets/jsm/AestheticFluidBg.module.js';

import { useSearchParams } from 'react-router-dom';
import { postLogin, getUserOauthSignupOrIn } from '@/api/User';
import { getGetSetting } from '@/api/Admin';

import { useForm, Controller } from 'react-hook-form';
import { styled } from '@mui/material/styles';
import { useRequest } from 'ahooks';
import { DomainSetting } from '@/api/types';

// 样式化组件
const StyledContainer = styled(Container)(({ theme }) => ({
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  maxWidth: '100% !important',
  background: theme.palette.background.paper,
}));

const StyledPaper = styled(Paper)(({ theme }) => ({
  position: 'relative',
  zIndex: 9,
  padding: theme.spacing(4),
  background: 'rgba(255, 255, 255, 0.85)',
  backdropFilter: 'blur(10px)',
  width: 458,
  borderRadius: theme.spacing(2),
  boxShadow:
    '0px 0px 4px 0px rgba(54,59,76,0.1), 0px 20px 40px 0px rgba(54,59,76,0.1)',
}));

const LogoContainer = styled(Box)(({ theme }) => ({
  textAlign: 'center',
  marginBottom: theme.spacing(4),
}));

const LogoImage = styled('img')({
  width: 48,
  height: 48,
});

const LogoTitle = styled(Typography)(({ theme }) => ({
  fontSize: 28,
  fontWeight: 'bold',
  color: theme.palette.primary.main,
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
  '.MuiInputBase-root': {
    backgroundColor: '#fff',
    paddingLeft: '20px',
  },
  '.MuiInputBase-input': {
    paddingTop: '16px',
    paddingBottom: '16px',
    fontSize: 14,
  },
}));

const StyledButton = styled(Button)(({ theme }) => ({
  height: 48,
  textTransform: 'none',
}));

const IconWrapper = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.palette.text.primary,
  marginRight: theme.spacing(2),
  fontSize: 16,
}));

const TogglePasswordIcon = styled(Icon)({
  fontSize: 20,
});

// 表单数据类型
interface LoginFormData {
  username: string;
  password: string;
}

// 背景动画配置
const BACKGROUND_CONFIG = {
  dom: 'box',
  colors: ['#FDFDFD', '#DDDDDD', '#BBBBBB', '#555555', '#343434', '#010101'],
  loop: true,
} as const;

const AuthPage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [searchParams] = useSearchParams();
  const { data: loginSetting = {} as DomainSetting } =
    useRequest(getGetSetting);
  const { custom_oauth = {}, dingtalk_oauth = {} } = loginSetting;
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>();

  // 切换密码显示状态
  const togglePasswordVisibility = useCallback(() => {
    setShowPassword((prev) => !prev);
  }, []);

  // 处理登录表单提交
  const onSubmit = useCallback(
    async (data: LoginFormData) => {
      setLoading(true);
      setError(null);

      try {
        const sessionId = searchParams.get('session_id');
        if (!sessionId) {
          message.error('缺少会话ID参数');
          return;
        }

        // 用户登录
        const loginResult = await postLogin({
          ...data,
          session_id: sessionId,
        });

        if (!loginResult.redirect_url) {
          throw new Error('登录成功但未获取到重定向URL');
        }

        // 重定向到VSCode
        window.location.href = loginResult.redirect_url;

        // 记录授权日志
        console.log('VSCode 授权信息已发送:', {
          uri: loginResult.redirect_url,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : '登录失败，请重试';
        setError(errorMessage);
        console.error('登录失败:', err);
      } finally {
        setLoading(false);
      }
    },
    [searchParams]
  );

  // 初始化背景动画
  useEffect(() => {
    new AestheticFluidBg(BACKGROUND_CONFIG);
  }, []);

  const oauthEnable = useMemo(() => {
    return custom_oauth.enable || dingtalk_oauth.enable;
  }, [custom_oauth, dingtalk_oauth]);

  // 渲染用户名输入框
  const renderUsernameField = () => (
    <Controller
      name='username'
      control={control}
      defaultValue=''
      rules={{ required: '请输入用户名' }}
      render={({ field }) => (
        <StyledTextField
          {...field}
          fullWidth
          placeholder='请输入用户名'
          variant='outlined'
          error={!!errors.username}
          helperText={errors.username?.message}
          disabled={loading}
          slotProps={{
            input: {
              startAdornment: (
                <IconWrapper>
                  <Icon type='icon-zhanghao' />
                </IconWrapper>
              ),
            },
          }}
        />
      )}
    />
  );

  // 渲染密码输入框
  const renderPasswordField = () => (
    <Controller
      name='password'
      control={control}
      defaultValue=''
      rules={{ required: '请输入密码' }}
      render={({ field }) => (
        <StyledTextField
          {...field}
          fullWidth
          placeholder='请输入密码'
          type={showPassword ? 'text' : 'password'}
          variant='outlined'
          error={!!errors.password}
          helperText={errors.password?.message}
          disabled={loading}
          slotProps={{
            input: {
              startAdornment: (
                <IconWrapper>
                  <Icon type='icon-mima' />
                </IconWrapper>
              ),
              endAdornment: (
                <InputAdornment position='end'>
                  <IconButton
                    aria-label='切换密码显示'
                    onClick={togglePasswordVisibility}
                    edge='end'
                    disabled={loading}
                    size='small'
                  >
                    <TogglePasswordIcon
                      type={showPassword ? 'icon-kejian' : 'icon-bukejian'}
                    />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
      )}
    />
  );

  // 渲染登录按钮
  const renderLoginButton = () => (
    <Grid size={12}>
      <StyledButton
        type='submit'
        fullWidth
        variant='contained'
        size='large'
        disabled={loading}
      >
        {loading ? <CircularProgress size={18} /> : '登录并授权 VSCode'}
      </StyledButton>
    </Grid>
  );

  const onOauthLogin = (platform: 'dingtalk' | 'custom') => {
    getUserOauthSignupOrIn({
      platform,
      redirect_url: window.location.origin + window.location.pathname,
      // @ts-ignore
      session_id: searchParams.get('session_id') || null,
    }).then((res) => {
      if (res.url) {
        window.location.href = res.url;
      }
    });
  };

  const oauthLogin = () => {
    return (
      <Stack justifyContent='center'>
        <Divider sx={{ my: 3, fontSize: 12, borderColor: 'divider' }}>
          使用其他方式登录
        </Divider>
        {dingtalk_oauth.enable && (
          <IconButton
            sx={{ alignSelf: 'center' }}
            onClick={() => onOauthLogin('dingtalk')}
          >
            <Icon type='icon-dingding' sx={{ fontSize: 30 }} />
          </IconButton>
        )}
        {custom_oauth.enable && (
          <IconButton
            sx={{ alignSelf: 'center' }}
            onClick={() => onOauthLogin('custom')}
          >
            <Icon type='icon-oauth' sx={{ fontSize: 30 }} />
          </IconButton>
        )}
      </Stack>
    );
  };

  // 渲染登录表单
  const renderLoginForm = () => (
    <>
      <Box component='form' onSubmit={handleSubmit(onSubmit)}>
        <Grid container spacing={4}>
          <Grid size={12}>{renderUsernameField()}</Grid>
          <Grid size={12}>{renderPasswordField()}</Grid>

          {renderLoginButton()}
        </Grid>
      </Box>
    </>
  );

  useEffect(() => {
    const redirect_url = searchParams.get('redirect_url');
    if (redirect_url) {
      window.location.href = redirect_url;
    }
  }, []);

  return (
    <StyledContainer id='box'>
      <StyledPaper elevation={3}>
        <LogoContainer>
          <LogoImage src={Logo} alt='Monkey Code Logo' />
          <LogoTitle variant='h4' gutterBottom>
            Monkey Code
          </LogoTitle>
        </LogoContainer>
        {!loginSetting.disable_password_login && renderLoginForm()}
        {oauthEnable && oauthLogin()}
      </StyledPaper>
    </StyledContainer>
  );
};

export default AuthPage;
