import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Container,
  Paper,
  CircularProgress,
  Grid,
  InputAdornment,
  IconButton,
  Stack,
  Divider,
} from '@mui/material';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { postAdminLogin } from '@/api/Admin';
import { useForm, Controller } from 'react-hook-form';
import { styled } from '@mui/material/styles';
import { ConstsLoginSource, DomainSetting } from '@/api/types';
import { Icon, CusTabs } from '@ctzhian/ui';
import Logo from '@/assets/images/logo.png';
import { getRedirectUrl } from '@/utils';
import { getGetSetting } from '@/api/Admin';
import { postLogin, getUserOauthSignupOrIn } from '@/api/User';
import { useRequest } from 'ahooks';

// @ts-ignore
import { AestheticFluidBg } from '@/assets/jsm/AestheticFluidBg.module.js';

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
  background: 'rgba(240, 240, 240, 0.85)',
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

// 表单数据类型
interface LoginFormData {
  username: string;
  password: string;
}

type TabType = 'user' | 'admin';

const LoginPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tab: tabParam } = useParams();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [tab, setTab] = useState<TabType>((tabParam as TabType) || 'user');
  const { data: loginSetting = {} as DomainSetting } =
    useRequest(getGetSetting);
  const { custom_oauth = {}, dingtalk_oauth = {} } = loginSetting;

  useEffect(() => {
    if (tabParam) {
      setTab(tabParam as TabType);
    }
  }, [tabParam]);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>();

  const loginUser = async (data: LoginFormData) => {
    return postAdminLogin({
      username: data.username,
      password: data.password,
      source: ConstsLoginSource.LoginSourceBrowser,
    });
  };

  // 处理登录表单提交
  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);

    if (tab === 'admin') {
      try {
        await loginUser(data);
        const redirectUrl = getRedirectUrl();
        window.location.href = redirectUrl.href;
      } finally {
        setLoading(false);
      }
    }
    if (tab === 'user') {
      try {
        // 用户登录
        await postLogin({
          ...data,
          source: ConstsLoginSource.LoginSourceBrowser,
        });
        const redirectUrl = getRedirectUrl('user');
        window.location.href = redirectUrl.href;
      } finally {
        setLoading(false);
      }
    }
  };

  const oauthEnable = useMemo(() => {
    return (
      (loginSetting.custom_oauth?.enable ||
        loginSetting.dingtalk_oauth?.enable) &&
      tab === 'user'
    );
  }, [loginSetting, tab]);

  const disablePasswordLogin = useMemo(() => {
    return loginSetting.disable_password_login && tab === 'user';
  }, [loginSetting, tab]);

  const onOauthLogin = (platform: 'dingtalk' | 'custom') => {
    const redirectUrl = getRedirectUrl('user');
    getUserOauthSignupOrIn({
      platform,
      redirect_url: redirectUrl.href,
      source: ConstsLoginSource.LoginSourceBrowser,
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

  useEffect(() => {
    new AestheticFluidBg({
      dom: 'box',
      colors: [
        '#FDFDFD',
        '#DDDDDD',
        '#BBBBBB',
        '#555555',
        '#343434',
        '#010101',
      ],
      loop: true,
    });
  }, []);

  return (
    <StyledContainer id='box'>
      <StyledPaper elevation={3}>
        <LogoContainer>
          <Box component='img' src={Logo} sx={{ width: 48, height: 48 }} />
          <Typography
            variant='h4'
            component='h1'
            gutterBottom
            fontWeight='bold'
            color='primary'
            sx={{
              fontSize: 28,
            }}
          >
            Monkey Code
          </Typography>
        </LogoContainer>

        <CusTabs
          list={[
            { label: '研发成员', value: 'user' },
            { label: '管理员', value: 'admin' },
          ]}
          value={tab}
          onChange={(value: TabType) => {
            setTab(value);
            navigate(`/login/${value}?${searchParams.toString()}`);
          }}
          sx={{
            width: '100%',
            mb: 4,
            height: 40,
            border: 'none',
            padding: '4px',
            '.MuiTab-root': {
              width: '50%',
              height: 32,
              fontSize: 14,
              '&.Mui-selected': {
                color: 'text.primary',
                fontWeight: 500,
              },
            },
            '.MuiTabs-scroller': {
              height: 32,
            },
            '.MuiTabs-indicator': {
              borderRadius: '10px',
              height: 32,
              backgroundColor: '#fff',
            },
            bgcolor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '10px',
          }}
        />

        {!disablePasswordLogin && (
          <Box component='form' onSubmit={handleSubmit(onSubmit)}>
            <Grid container spacing={4}>
              <Grid size={12}>
                <Controller
                  name='username'
                  control={control}
                  defaultValue=''
                  rules={{
                    required: '请输入用户名',
                    minLength: {
                      value: 2,
                      message: '用户名至少需要2个字符',
                    },
                  }}
                  render={({ field }) => (
                    <TextField
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
                            <Icon
                              type='icon-zhanghao'
                              sx={{
                                color: 'text.primary',
                                mr: 1,
                                fontSize: 18,
                              }}
                            />
                          ),
                        },
                      }}
                    />
                  )}
                />
              </Grid>

              <Grid size={12}>
                <Controller
                  name='password'
                  control={control}
                  defaultValue=''
                  rules={{
                    required: '请输入密码',
                    minLength: {
                      value: 3,
                      message: '密码至少需要3个字符',
                    },
                  }}
                  render={({ field }) => (
                    <TextField
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
                            <Icon
                              type='icon-mima'
                              sx={{
                                color: 'text.primary',
                                mr: 1,
                                fontSize: 24,
                              }}
                            />
                          ),
                          endAdornment: (
                            <InputAdornment position='end'>
                              <IconButton
                                aria-label='切换密码显示'
                                onClick={() => setShowPassword(!showPassword)}
                                edge='end'
                                disabled={loading}
                                size='small'
                              >
                                {showPassword ? (
                                  <Icon
                                    type='icon-kejian'
                                    sx={{ fontSize: 20 }}
                                  />
                                ) : (
                                  <Icon
                                    type='icon-bukejian'
                                    sx={{ fontSize: 20 }}
                                  />
                                )}
                              </IconButton>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                  )}
                />
              </Grid>

              <Grid size={12}>
                <Button
                  type='submit'
                  fullWidth
                  variant='contained'
                  size='large'
                  disabled={loading}
                  sx={{ height: 48, textTransform: 'none' }}
                >
                  {loading ? <CircularProgress size={18} /> : '登录'}
                </Button>
              </Grid>
            </Grid>
          </Box>
        )}
        {oauthEnable && oauthLogin()}
      </StyledPaper>
    </StyledContainer>
  );
};

export default LoginPage;
