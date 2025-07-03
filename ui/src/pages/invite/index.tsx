import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Logo from '@/assets/images/logo.png';

// @ts-ignore
import { AestheticFluidBg } from '@/assets/jsm/AestheticFluidBg.module.js';

import {
  Box,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Button,
  Typography,
  Container,
  Paper,
  Grid2 as Grid,
  InputAdornment,
  IconButton,
  CircularProgress,
  Stack,
} from '@mui/material';
import { useRequest } from 'ahooks';
import {
  postRegister,
  getUserOauthSignupOrIn,
  getGetSetting,
} from '@/api/User';
import { Icon } from '@c-x/ui';

import DownloadIcon from '@mui/icons-material/Download';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { Controller, useForm } from 'react-hook-form';
import { styled } from '@mui/material/styles';

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
  width: 500,
  borderRadius: theme.spacing(2),
  boxShadow:
    '0px 0px 4px 0px rgba(54,59,76,0.1), 0px 20px 40px 0px rgba(54,59,76,0.1)',
}));

const LogoContainer = styled(Box)(({ theme }) => ({
  textAlign: 'center',
  marginBottom: theme.spacing(4),
}));

const StepCard = styled(Box)(({ theme }) => ({
  textAlign: 'center',
  padding: theme.spacing(4),
  borderRadius: theme.spacing(2),
}));

const IconWrapper = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.palette.text.primary,
  marginRight: theme.spacing(2),
  fontSize: 16,
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

const Invite = () => {
  const { id, step } = useParams();
  const [showPassword, setShowPassword] = useState(false);
  const { data: loginSetting = {} } = useRequest(getGetSetting);
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: {
      email: '',
      password: '',
      username: '',
    },
  });

  const { runAsync: register, loading } = useRequest(postRegister, {
    manual: true,
  });
  const [activeStep, setActiveStep] = useState(step ? parseInt(step) : 1);

  const onNext = () => {
    setActiveStep(activeStep + 1);
  };

  const onRegister = handleSubmit((data) => {
    register({ ...data, code: id! }).then(() => {
      onNext();
    });
  });

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

  const onDingdingLogin = () => {
    getUserOauthSignupOrIn({
      platform: 'dingtalk',
      redirect_url: `${window.location.origin}/invite/${id}/2`,
    }).then((res) => {
      window.location.href = res.url!;
    });
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 1:
        return !loginSetting.enable_dingtalk_oauth ? (
          <Box component='form' onSubmit={onRegister}>
            <Grid container spacing={3}>
              <Grid size={12}>
                <Controller
                  name='username'
                  control={control}
                  rules={{
                    required: '请输入用户名',
                  }}
                  render={({ field }) => (
                    <StyledTextField
                      {...field}
                      fullWidth
                      placeholder='请输入您的用户名'
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
              </Grid>
              <Grid size={12}>
                <Controller
                  name='email'
                  control={control}
                  rules={{
                    required: '请输入邮箱',
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: '请输入正确的邮箱地址',
                    },
                  }}
                  render={({ field }) => (
                    <StyledTextField
                      {...field}
                      fullWidth
                      placeholder='请输入您的邮箱地址'
                      variant='outlined'
                      error={!!errors.email}
                      helperText={errors.email?.message}
                      disabled={loading}
                      slotProps={{
                        input: {
                          startAdornment: (
                            <IconWrapper>
                              <Icon type='icon-youxiang' />
                            </IconWrapper>
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
                  rules={{
                    required: '请输入密码',
                    minLength: {
                      value: 8,
                      message: '密码至少需要8位',
                    },
                  }}
                  render={({ field }) => (
                    <StyledTextField
                      {...field}
                      fullWidth
                      placeholder='请设置您的密码'
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
                  {loading ? <CircularProgress size={18} /> : '立即注册'}
                </Button>
              </Grid>
            </Grid>
          </Box>
        ) : (
          <Stack>
            <Button
              size='large'
              variant='contained'
              sx={{ alignSelf: 'center' }}
              onClick={onDingdingLogin}
            >
              <Icon type='icon-dingding' sx={{ fontSize: 20, mr: 1 }} />
              使用钉钉登录
            </Button>
          </Stack>
        );

      case 2:
        return (
          <StepCard>
            <DownloadIcon sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
            <Typography variant='h6' gutterBottom fontWeight='bold'>
              下载 MonkeyCode 客户端
            </Typography>
            <Typography variant='body2' color='text.secondary' sx={{ mb: 3 }}>
              请下载并安装 MonkeyCode 客户端，这是使用我们服务的必要步骤
            </Typography>
            <Button
              variant='contained'
              startIcon={<DownloadIcon />}
              href='/api/v1/static/vsix'
              download='monkeycode-client.vsix'
              rel='noopener noreferrer'
              size='large'
              sx={{
                textTransform: 'none',
                px: 4,
                py: 1.5,
                borderRadius: 1,
                height: 48,
              }}
              onClick={() => {
                setTimeout(() => {
                  onNext();
                }, 500);
              }}
            >
              下载客户端
            </Button>
          </StepCard>
        );

      case 3:
        return (
          <StepCard>
            <MenuBookIcon sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
            <Typography variant='h6' gutterBottom fontWeight='bold'>
              使用教程
            </Typography>
            <Typography variant='body2' color='text.secondary' sx={{ mb: 3 }}>
              查看详细的使用教程，快速上手 MonkeyCode 客户端
            </Typography>
            <Button
              variant='outlined'
              startIcon={<MenuBookIcon />}
              href='https://www.monkeycode.cn/docs/client/quick-start'
              target='_blank'
              rel='noopener noreferrer'
              size='large'
              sx={{
                textTransform: 'none',
                px: 4,
                py: 1.5,
                borderRadius: 1,
                height: 48,
              }}
            >
              查看教程
            </Button>
          </StepCard>
        );

      default:
        return null;
    }
  };

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
          <Typography variant='body1' color='text.secondary' sx={{ mb: 2 }}>
            欢迎加入
          </Typography>
          <Typography variant='body2' color='text.secondary' sx={{ mb: 4 }}>
            请完成以下步骤开始使用我们的服务
          </Typography>
        </LogoContainer>

        <Stepper
          activeStep={activeStep - 1}
          alternativeLabel
          sx={{
            mb: 4,
            '& .MuiStepLabel-root .Mui-completed': {
              color: 'primary.main',
            },
            '& .MuiStepLabel-root .Mui-active': {
              color: 'primary.main',
            },
          }}
        >
          <Step>
            <StepLabel>注册账号</StepLabel>
          </Step>
          <Step>
            <StepLabel>下载客户端</StepLabel>
          </Step>
          <Step>
            <StepLabel>使用教程</StepLabel>
          </Step>
        </Stepper>

        {renderStepContent()}
      </StyledPaper>
    </StyledContainer>
  );
};

export default Invite;
