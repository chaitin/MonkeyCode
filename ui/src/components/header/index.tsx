import { Button, IconButton, Stack, Tooltip } from '@mui/material';
import { message } from '@ctzhian/ui';
import { postLogout } from '@/api/User';
import { postAdminLogout } from '@/api/Admin';
import { useNavigate, useLocation } from 'react-router-dom';
import LogoutIcon from '@mui/icons-material/Logout';
import DownloadIcon from '@mui/icons-material/Download';
import Bread from './Bread';

const Header = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onLogout = async () => {
    if (pathname.startsWith('/user')) {
      await postLogout();
    } else {
      await postAdminLogout();
    }
    message.success('退出登录成功');
    navigate(pathname.startsWith('/user') ? '/login/user' : '/login/admin');
  };
  return (
    <Stack
      direction={'row'}
      alignItems={'center'}
      justifyContent={'space-between'}
      sx={{
        mt: 2,
        pr: 2,
        width: '100%',
      }}
    >
      <Bread />

      <Stack direction={'row'} alignItems={'center'} gap={2}>
        <Button
          variant='contained'
          size='small'
          startIcon={<DownloadIcon />}
          href='/api/v1/static/vsix'
          download='monkeycode-client.vsix'
          rel='noopener noreferrer'
        >
          下载 VSCode 插件
        </Button>
        <Tooltip title='退出登录'>
          <IconButton
            size='small'
            sx={{
              bgcolor: '#fff',

              '&:hover': {
                color: 'primary.main',
              },
            }}
            onClick={onLogout}
          >
            <LogoutIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
};

export default Header;
