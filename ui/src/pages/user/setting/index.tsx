import React, { useState, useEffect } from 'react';
import {
  Stack,
  Box,
  Button,
  TextField,
  Typography,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import { message, Modal } from '@ctzhian/ui';
import { useForm, Controller } from 'react-hook-form';
import { useRequest } from 'ahooks';
import Card from '@/components/card';
import { FormItem } from '@/components/form';
import Avatar from '@/components/avatar';
import { useAuthContext } from '@/hooks/context';
import { getUserProfile, putUserUpdateProfile } from '@/api/UserManage';
import { DomainProfileUpdateReq, DomainUser } from '@/api/types';

interface PasswordFormData {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface ProfileFormData {
  username: string;
  avatar: string;
}

const UserSetting = () => {
  const [user, { setUser, refreshUser }] = useAuthContext();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');

  // 用户信息表单
  const {
    control: profileControl,
    handleSubmit: handleProfileSubmit,
    setValue: setProfileValue,
    watch: watchProfile,
  } = useForm<ProfileFormData>({
    defaultValues: {
      username: '',
      avatar: '',
    },
  });

  // 密码修改表单
  const {
    control: passwordControl,
    handleSubmit: handlePasswordSubmit,
    formState: { errors: passwordErrors },
    reset: resetPasswordForm,
    watch: watchPassword,
  } = useForm<PasswordFormData>({
    defaultValues: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  // 获取用户信息
  const { loading: profileLoading } = useRequest(getUserProfile, {
    onSuccess: (res) => {
      if (res) {
        setProfileValue('username', res.username || '');
        setProfileValue('avatar', res.avatar_url || '');
        setAvatarUrl(res.avatar_url || '');
      }
    },
  });

  // 重置头像弹窗状态
  const resetAvatarDialog = () => {
    setAvatarDialogOpen(false);
    setSelectedFile(null);
    setPreviewUrl('');
    setAvatarUrl(currentAvatar);
  };

  // 更新用户信息
  const { loading: updateLoading, run: updateProfile } = useRequest(
    putUserUpdateProfile,
    {
      manual: true,
      onSuccess: (res) => {
        message.success('更新成功');
        if (res) {
          setUser(res);
          refreshUser();
        }
      },
    }
  );

  // 提交用户信息更新
  const onProfileSubmit = (data: ProfileFormData) => {
    const params: DomainProfileUpdateReq = {
      username: data.username,
    };

    if (data.avatar !== (user as DomainUser)?.avatar_url) {
      params.avatar = data.avatar;
    }

    updateProfile(params);
  };

  // 提交密码修改
  const onPasswordSubmit = (data: PasswordFormData) => {
    const params: DomainProfileUpdateReq = {
      old_password: data.oldPassword,
      password: data.newPassword,
    };

    updateProfile(params);
    setPasswordDialogOpen(false);
    resetPasswordForm();
  };

  // 处理文件选择
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      message.error('请选择图片文件');
      return;
    }

    // 检查文件大小（限制为2MB）
    if (file.size > 2 * 1024 * 1024) {
      message.error('图片大小不能超过2MB');
      return;
    }

    setSelectedFile(file);

    // 创建预览URL
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setPreviewUrl(result);
      setAvatarUrl(result);
    };
    reader.readAsDataURL(file);

    setAvatarDialogOpen(true);
  };

  // 头像提交处理
  const handleAvatarSubmit = () => {
    if (previewUrl) {
      setProfileValue('avatar', previewUrl);
    } else {
      setProfileValue('avatar', avatarUrl);
    }
    resetAvatarDialog();
  };

  // 打开文件选择对话框
  const triggerFileSelect = () => {
    const fileInput = document.getElementById(
      'avatar-file-input'
    ) as HTMLInputElement;
    fileInput?.click();
  };

  const currentUsername = watchProfile('username');
  const currentAvatar = watchProfile('avatar');
  const newPassword = watchPassword('newPassword');

  return (
    <Stack gap={3} sx={{ maxWidth: 800, mx: 'auto', py: 2 }}>
      {/* 页面标题 */}
      <Typography variant='h5' sx={{ fontWeight: 700, mb: 2 }}>
        账户设置
      </Typography>

      {/* 头像设置 */}
      <Card sx={{ p: 3 }}>
        <Typography variant='h6' sx={{ fontWeight: 600, mb: 3 }}>
          头像
        </Typography>
        <Stack direction='row' alignItems='center' gap={3}>
          <Box
            sx={{
              position: 'relative',
              cursor: 'pointer',
              '&:hover': {
                opacity: 0.8,
              },
            }}
            onClick={triggerFileSelect}
          >
            <Avatar
              src={currentAvatar}
              name={currentUsername}
              sx={{ width: 80, height: 80, fontSize: 24 }}
            />
            <IconButton
              sx={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                bgcolor: 'primary.main',
                color: 'white',
                width: 32,
                height: 32,
                '&:hover': {
                  bgcolor: 'primary.dark',
                },
              }}
            >
              <PhotoCameraIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
          <Stack>
            <Typography variant='body1' sx={{ fontWeight: 500 }}>
              更改头像
            </Typography>
            <Typography variant='body2' color='text.secondary'>
              点击头像或相机图标来选择本地图片文件
            </Typography>
          </Stack>
          {/* 隐藏的文件输入控件 */}
          <input
            id='avatar-file-input'
            type='file'
            accept='image/*'
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </Stack>
      </Card>

      {/* 基本信息 */}
      <Card sx={{ p: 3 }}>
        <Typography variant='h6' sx={{ fontWeight: 600, mb: 3 }}>
          基本信息
        </Typography>
        <form onSubmit={handleProfileSubmit(onProfileSubmit)}>
          <Stack gap={3}>
            <FormItem label='用户名' required>
              <Controller
                name='username'
                control={profileControl}
                rules={{
                  required: '用户名不能为空',
                  minLength: {
                    value: 2,
                    message: '用户名至少2个字符',
                  },
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    fullWidth
                    size='small'
                    placeholder='请输入用户名'
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </FormItem>

            <FormItem label='邮箱'>
              <TextField
                fullWidth
                size='small'
                value={(user as DomainUser)?.email || ''}
                disabled
                helperText='邮箱地址无法修改'
              />
            </FormItem>

            <Box sx={{ display: 'flex', gap: 2, pt: 2 }}>
              <Button
                type='submit'
                variant='contained'
                disabled={updateLoading || profileLoading}
                sx={{ minWidth: 100 }}
              >
                {updateLoading ? '保存中...' : '保存更改'}
              </Button>
            </Box>
          </Stack>
        </form>
      </Card>

      {/* 密码设置 */}
      <Card sx={{ p: 3 }}>
        <Typography variant='h6' sx={{ fontWeight: 600, mb: 3 }}>
          密码设置
        </Typography>
        <Stack
          direction='row'
          alignItems='center'
          justifyContent='space-between'
        >
          <Stack>
            <Typography variant='body1' sx={{ fontWeight: 500 }}>
              修改密码
            </Typography>
            <Typography variant='body2' color='text.secondary'>
              为了账户安全，建议定期更换密码
            </Typography>
          </Stack>
          <Button
            variant='outlined'
            startIcon={<EditIcon />}
            onClick={() => setPasswordDialogOpen(true)}
          >
            修改密码
          </Button>
        </Stack>
      </Card>

      {/* 修改密码弹窗 */}
      <Modal
        title='修改密码'
        open={passwordDialogOpen}
        onCancel={() => setPasswordDialogOpen(false)}
        width={600}
        onOk={handlePasswordSubmit(onPasswordSubmit)}
      >
        <form onSubmit={handlePasswordSubmit(onPasswordSubmit)}>
          <Stack gap={3}>
            <FormItem label='当前密码' required>
              <Controller
                name='oldPassword'
                control={passwordControl}
                rules={{ required: '请输入当前密码' }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    type='password'
                    fullWidth
                    size='small'
                    placeholder='请输入当前密码'
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </FormItem>

            <FormItem label='新密码' required>
              <Controller
                name='newPassword'
                control={passwordControl}
                rules={{
                  required: '请输入新密码',
                  minLength: {
                    value: 6,
                    message: '密码长度至少6位',
                  },
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    type='password'
                    fullWidth
                    size='small'
                    placeholder='请输入新密码'
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </FormItem>

            <FormItem label='确认新密码' required>
              <Controller
                name='confirmPassword'
                control={passwordControl}
                rules={{
                  required: '请确认新密码',
                  validate: (value) => {
                    return value === newPassword || '两次输入的密码不一致';
                  },
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    type='password'
                    fullWidth
                    size='small'
                    placeholder='请再次输入新密码'
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                  />
                )}
              />
            </FormItem>
          </Stack>
        </form>
      </Modal>

      {/* 头像设置弹窗 */}
      <Modal
        title='更改头像'
        open={avatarDialogOpen}
        onCancel={resetAvatarDialog}
        width={800}
        onOk={handleAvatarSubmit}
      >
        <Stack gap={3} alignItems='center'>
          <Avatar
            src={previewUrl || avatarUrl}
            name={currentUsername}
            sx={{ width: 120, height: 120, fontSize: 36 }}
          />

          {selectedFile && (
            <Typography variant='body2' color='text.secondary'>
              已选择文件：{selectedFile.name}
            </Typography>
          )}

          <Stack direction='row' gap={2} width='100%'>
            <Button
              variant='outlined'
              fullWidth
              onClick={triggerFileSelect}
              startIcon={<PhotoCameraIcon />}
            >
              选择文件
            </Button>
            <Button
              variant='outlined'
              fullWidth
              onClick={() => {
                setSelectedFile(null);
                setPreviewUrl('');
                setAvatarUrl('');
              }}
            >
              输入链接
            </Button>
          </Stack>

          {!selectedFile && (
            <TextField
              fullWidth
              label='头像URL'
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder='请输入头像图片链接'
              helperText='支持 http:// 或 https:// 开头的图片链接'
            />
          )}
        </Stack>
      </Modal>
    </Stack>
  );
};

export default UserSetting;
