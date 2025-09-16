import Card from '@/components/card';
import { Box, Button, Stack, TextField } from '@mui/material';
import { message } from '@ctzhian/ui';
import { useEffect, useState } from 'react';
import { getGetSetting, putUpdateSetting } from '@/api/Admin';
import { DomainUpdateSettingReq } from '@/api/types';

const CardServiceSettings = () => {
  const [baseURL, setBaseURL] = useState('');
  const [initialBaseURL, setInitialBaseURL] = useState('');

  useEffect(() => {
    const fetchInitialBaseURL = async () => {
      try {
        const response = await getGetSetting();
        const initialValue = response.base_url || '';
        setBaseURL(initialValue);
        setInitialBaseURL(initialValue);
      } catch (err: any) {
        message.error('Failed to fetch initial base URL:', err);
        // 如果获取失败，可以设置一个默认值或者保持空字符串
        setBaseURL('');
        setInitialBaseURL('');
      }
    };

    fetchInitialBaseURL();
  }, []);

  const handleBaseURLChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setBaseURL(event.target.value);
  };

  const isValidURL = (url: string): boolean => {
    try {
      const parsedURL = new URL(url);
      // Check if the protocol is either http or https
      if (parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') {
        return false;
      }
      // Check if the URL is a base URL (no path or only root path)
      if (parsedURL.pathname !== '/' && parsedURL.pathname !== '') {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  };

  const handleSave = async () => {
    // Check if the baseURL is valid before saving
    if (baseURL && !isValidURL(baseURL)) {
      message.error('请输入一个有效的 URL 地址');
      return;
    }

    try {
      const setting: DomainUpdateSettingReq = {
        base_url: baseURL,
      };
      await putUpdateSetting(setting);
      message.success('保存成功');
      setInitialBaseURL(baseURL);
    } catch (err: any) {
      message.error('保存失败:', err);
    }
  };

  const hasValueChanged = baseURL !== initialBaseURL;

  return (
    <Card sx={{ p: 0, mb: 2, borderBottom: '1px solid #e0e0e0' }}>
      <Box
        sx={{
          fontWeight: 'bold',
          px: 2,
          py: 1.5,
          bgcolor: 'rgb(248, 249, 250)',
          borderTopLeftRadius: '10px',
          borderTopRightRadius: '10px',
        }}
      >
        MonkeyCode 服务配置
      </Box>
      <Stack direction='column'>
        <Box sx={{ width: '100%' }}>
          <Stack
            direction='row'
            alignItems={'center'}
            justifyContent={'space-between'}
            sx={{
              m: 2,
              height: 32,
              fontWeight: 'bold',
            }}
          >
            <Box
              sx={{
                '&::before': {
                  content: '""',
                  display: 'inline-block',
                  width: 4,
                  height: 12,
                  bgcolor: 'common.black',
                  borderRadius: '2px',
                  mr: 1,
                },
              }}
            >
              MonkeyCode 服务连接地址
            </Box>
            {hasValueChanged && (
              <Button variant='contained' size='small' onClick={handleSave}>
                保存
              </Button>
            )}
          </Stack>
          <Box sx={{ m: 2 }}>
            <TextField
              fullWidth
              value={baseURL}
              onChange={handleBaseURLChange}
              placeholder={baseURL ? '' : window.location.origin}
            />
            <Box
              sx={{
                mt: 1,
                fontSize: '0.75rem',
                color: 'warning.main',
                fontWeight: 'normal',
              }}
            >
              用于解决 VSCode 插件无法连接 MonkeyCode 服务的问题
            </Box>
          </Box>
        </Box>
      </Stack>
    </Card>
  );
};

export default CardServiceSettings;
