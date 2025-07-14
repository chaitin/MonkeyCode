import React, { useState, useMemo } from 'react';
import Card from '@/components/card';
import {
  Grid2 as Grid,
  Stack,
  styled,
  Switch,
  Button,
  Box,
} from '@mui/material';
import { useRequest } from 'ahooks';
import { getGetSetting, putUpdateSetting } from '@/api/Admin';
import MemberManage from './memberManage';
import LoginHistory from './loginHistory';
import { message } from '@c-x/ui';
import ThirdPartyLoginSettingModal from './thirdPartyLoginSettingModal';

const StyledCard = styled(Card)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  boxShadow:
    '0px 0px 10px 0px rgba(68, 80, 91, 0.1), 0px 0px 2px 0px rgba(68, 80, 91, 0.1)',
});

const StyledLabel = styled('div')(({ theme }) => ({
  fontWeight: 700,
  fontSize: 14,
  color: theme.vars.palette.text.primary,
}));

const OAUTH_LOGIN_TYPE_KEYS = ['dingtalk_oauth', 'custom_oauth'];

const OAUTH_LOGIN_TYPE_LABELS = {
  custom_oauth: '已开启 OAuth 登录',
  dingtalk_oauth: '已开启钉钉登录',
};

type OAUTH_LOGIN_TYPE_KEYS = keyof typeof OAUTH_LOGIN_TYPE_LABELS;

const User = () => {
  const [thirdPartyLoginSettingModalOpen, setThirdPartyLoginSettingModalOpen] =
    useState(false);
  const { data, refresh } = useRequest(getGetSetting);

  const { runAsync: updateSetting } = useRequest(putUpdateSetting, {
    manual: true,
    onSuccess: () => {
      refresh();
      message.success('设置更新成功');
    },
  });

  const oauthLabel = useMemo(() => {
    if (!data) return '未开启';
    const key = OAUTH_LOGIN_TYPE_KEYS.find(
      (key) => data[key as OAUTH_LOGIN_TYPE_KEYS]?.enable
    );
    return key
      ? OAUTH_LOGIN_TYPE_LABELS[key as OAUTH_LOGIN_TYPE_KEYS]
      : '未开启';
  }, [data]);

  return (
    <Stack gap={2} sx={{ height: '100%' }}>
      <Grid container spacing={2} sx={{ height: '100%' }}>
        <Grid size={6} sx={{ height: '100%' }}>
          <MemberManage />
        </Grid>
        <Grid size={6} container sx={{ height: '100%' }}>
          <Stack gap={2} sx={{ height: '100%' }}>
            <StyledCard>
              <StyledLabel>强制成员启用两步认证</StyledLabel>
              <Switch
                checked={data?.force_two_factor_auth}
                onChange={(e) => {
                  updateSetting({ force_two_factor_auth: e.target.checked });
                }}
              />
            </StyledCard>
            <StyledCard>
              <StyledLabel>禁止成员使用密码登录</StyledLabel>
              <Switch
                checked={data?.disable_password_login}
                onChange={(e) =>
                  updateSetting({ disable_password_login: e.target.checked })
                }
              />
            </StyledCard>
            <StyledCard>
              <StyledLabel>
                第三方登录
                <Box
                  component='span'
                  sx={{
                    ml: 2,
                    color: oauthLabel ? 'success.main' : 'gray',
                    fontWeight: 400,
                    fontSize: 13,
                  }}
                >
                  {oauthLabel}
                </Box>
              </StyledLabel>
              <Button
                color='info'
                sx={{ gap: 2 }}
                onClick={() => setThirdPartyLoginSettingModalOpen(true)}
              >
                配置
              </Button>
            </StyledCard>
            <LoginHistory />
          </Stack>
        </Grid>
      </Grid>

      <ThirdPartyLoginSettingModal
        open={thirdPartyLoginSettingModalOpen}
        onCancel={() => setThirdPartyLoginSettingModalOpen(false)}
        settingData={data || {}}
        onOk={() => {
          refresh();
        }}
      />
    </Stack>
  );
};

export default User;
