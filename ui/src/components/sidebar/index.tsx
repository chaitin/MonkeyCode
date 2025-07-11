import Logo from '@/assets/images/logo.png';
import { alpha, Box, Button, Stack, useTheme, styled } from '@mui/material';
import { Icon } from '@c-x/ui';
import { NavLink, useLocation } from 'react-router-dom';
import { Modal } from '@c-x/ui';
import { useMemo, useState } from 'react';
import Qrcode from '@/assets/images/qrcode.png';
import Version from './version';

const ADMIN_MENUS = [
  {
    label: '仪表盘',
    value: '/dashboard',
    pathname: 'dashboard',
    icon: 'icon-yibiaopan',
    show: true,
  },
  {
    label: '对话记录',
    value: '/chat',
    pathname: 'chat',
    icon: 'icon-duihuajilu1',
    show: true,
  },
  {
    label: '补全记录',
    value: '/completion',
    pathname: 'completion',
    icon: 'icon-buquanjilu',
    show: true,
  },
  {
    label: '代码安全',
    value: '/code-security',
    pathname: 'code-security',
    icon: 'icon-daimaanquan1',
    show: true,
  },
  {
    label: '模型管理',
    value: '/model',
    pathname: 'model',
    icon: 'icon-moxingguanli',
    show: true,
  },
  {
    label: '成员管理',
    value: '/user-management',
    pathname: 'user-management',
    icon: 'icon-yonghuguanli1',
    show: true,
  },
  {
    label: '管理员',
    value: '/admin',
    pathname: 'admin',
    icon: 'icon-guanliyuan1',
    show: true,
  },
];

const USER_MENUS = [
  {
    label: '仪表盘',
    value: '/user/dashboard',
    pathname: '/user/dashboard',
    icon: 'icon-yibiaopan',
    show: true,
  },
  {
    label: '对话记录',
    value: '/user/chat',
    pathname: '/user/chat',
    icon: 'icon-duihuajilu1',
    show: true,
  },
  {
    label: '补全记录',
    value: '/user/completion',
    pathname: '/user/completion',
    icon: 'icon-buquanjilu',
    show: true,
  },
];

const SidebarButton = styled(Button)(({ theme }) => ({
  fontSize: 14,
  flexShrink: 0,
  fontWeight: 400,
  pr: 1.5,
  pl: 2,
  justifyContent: 'flex-start',
  border: `1px solid ${theme.palette.divider}`,
  color: theme.palette.text.primary,
  '.MuiButton-startIcon': {
    mr: '3px',
  },
  '&:hover': {
    color: theme.palette.info.main,
  },
}));

const Sidebar = () => {
  const { pathname } = useLocation();
  const theme = useTheme();
  const [showQrcode, setShowQrcode] = useState(false);
  const menus = useMemo(() => {
    if (pathname.startsWith('/user/')) {
      return USER_MENUS;
    }
    return ADMIN_MENUS;
  }, [pathname]);

  return (
    <Stack
      sx={{
        width: 188,
        m: 2,
        zIndex: 999,
        p: 2,
        height: 'calc(100% - 32px)',
        bgcolor: '#FFFFFF',
        borderRadius: '10px',
      }}
    >
      <Stack
        direction={'row'}
        gap={1}
        alignItems={'center'}
        justifyContent='center'
        sx={{
          pb: 0,
          cursor: 'pointer',
          '&:hover': {
            color: 'info.main',
          },
        }}
        onClick={() => {
          window.open('https://baizhi.cloud', '_blank');
        }}
      >
        <Box component='img' src={Logo} sx={{ width: 32, height: 32 }} />
        <Box
          sx={{
            fontSize: '16px',
            fontWeight: 'bold',
            textAlign: 'center',
            '&:first-letter': {
              color: 'info.main',
            },
          }}
        >
          Monkey Code
        </Box>
      </Stack>

      <Stack sx={{ pt: 2, flexGrow: 1 }} gap={1}>
        {menus.map((it) => {
          let isActive = false;
          if (it.value === '/') {
            isActive = pathname === '/';
          } else {
            isActive = pathname.includes(it.value);
          }
          if (!it.show) return null;
          return (
            <NavLink
              key={it.pathname}
              to={it.value}
              style={{
                zIndex: isActive ? 2 : 1,
                color: isActive ? '#FFFFFF' : 'text.primary',
              }}
            >
              <Button
                variant={isActive ? 'contained' : 'text'}
                sx={{
                  width: '100%',
                  height: 50,
                  padding: '6px 16px',
                  justifyContent: 'flex-start',
                  color: isActive ? '#FFFFFF' : 'text.primary',
                  fontWeight: isActive ? '500' : '400',
                  boxShadow: isActive
                    ? '0px 10px 25px 0px rgba(33,34,45,0.2)'
                    : 'none',
                  ':hover': {
                    boxShadow: isActive
                      ? '0px 10px 25px 0px rgba(33,34,45,0.2)'
                      : 'none',
                  },
                }}
              >
                <Icon
                  type={it.icon}
                  sx={{
                    mr: 1,
                    fontSize: 14,
                    color: isActive
                      ? '#FFFFFF'
                      : alpha(theme.palette.text.primary, 0.2),
                  }}
                />
                {it.label}
              </Button>
            </NavLink>
          );
        })}
      </Stack>
      <Stack gap={1} sx={{ flexShrink: 0 }}>
        <SidebarButton
          variant='outlined'
          color='dark'
          onClick={() =>
            window.open('https://monkeycode.docs.baizhi.cloud/', '_blank')
          }
        >
          <Icon
            type='icon-bangzhuwendang1'
            sx={{
              mr: 1,
            }}
          />
          帮助文档
        </SidebarButton>
        <SidebarButton
          variant='outlined'
          color='dark'
          onClick={() =>
            window.open('https://github.com/chaitin/MonkeyCode', '_blank')
          }
        >
          <Icon
            type='icon-github'
            sx={{
              mr: 1,
            }}
          />
          GitHub
        </SidebarButton>
        <SidebarButton
          variant='outlined'
          color='dark'
          onClick={() => setShowQrcode(true)}
        >
          <Icon
            type='icon-group'
            sx={{
              mr: 1,
            }}
          />
          交流群
        </SidebarButton>
        <Version />
      </Stack>
      <Modal
        open={showQrcode}
        onCancel={() => setShowQrcode(false)}
        title='欢迎加入 MonkeyCode 交流群'
        footer={null}
      >
        <Stack alignItems={'center'} justifyContent={'center'} sx={{ my: 2 }}>
          <Box component='img' src={Qrcode} sx={{ width: 300 }} />
        </Stack>
      </Modal>
    </Stack>
  );
};

export default Sidebar;
