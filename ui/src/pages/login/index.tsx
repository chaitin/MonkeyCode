import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import { postAdminLogin } from '@/api/Admin';
import { useForm, Controller } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { styled } from '@mui/material/styles';
import { Icon } from '@c-x/ui';
import Logo from '@/assets/images/logo.png';
import { getRedirectUrl } from '@/utils';

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

// 表单数据类型
interface LoginFormData {
  username: string;
  password: string;
}

const LoginPage = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>();

  const loginUser = async (data: LoginFormData) => {
    return postAdminLogin({
      username: data.username,
      password: data.password,
    });
  };

  // 处理登录表单提交
  const onSubmit = async (data: LoginFormData) => {
    setLoading(true);
    setError(null);

    try {
      await loginUser(data);
      const redirectUrl = getRedirectUrl();
      window.location.href = redirectUrl.href;
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
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
          <Typography variant='body1' color='text.secondary' paragraph>
            请输入您的账号和密码
          </Typography>
        </LogoContainer>

        <Box component='form' onSubmit={handleSubmit(onSubmit)}>
          <Grid container spacing={5}>
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
      </StyledPaper>
    </StyledContainer>
  );
};

export default LoginPage;
