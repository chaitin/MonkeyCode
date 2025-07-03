import React, { useState } from 'react';
import Card from '@/components/card';
import {
  Grid2 as Grid,
  Stack,
  styled,
  Switch,
  Button,
  Box,
} from '@mui/material';
import { Icon, Modal } from '@c-x/ui';
import { useRequest } from 'ahooks';
import { getGetSetting, putUpdateSetting } from '@/api/User';
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

const User = () => {
  const [thirdPartyLoginSettingModalOpen, setThirdPartyLoginSettingModalOpen] =
    useState(false);
  const {
    data = {
      enable_sso: false,
      force_two_factor_auth: false,
      disable_password_login: false,
      enable_dingtalk_oauth: false,
    },
    refresh,
  } = useRequest(getGetSetting);

  const { runAsync: updateSetting } = useRequest(putUpdateSetting, {
    manual: true,
    onSuccess: () => {
      refresh();
      message.success('设置更新成功');
    },
  });

  return (
    <Stack gap={2}>
      <Grid container spacing={2}>
        <Grid size={6}>
          <MemberManage />
        </Grid>
        <Grid size={6} container spacing={2}>
          <Grid size={12}>
            <StyledCard>
              <StyledLabel>强制成员启用两步认证</StyledLabel>
              <Switch
                checked={data?.force_two_factor_auth}
                onChange={(e) => {
                  updateSetting({ force_two_factor_auth: e.target.checked });
                }}
              />
            </StyledCard>
          </Grid>
          <Grid size={12}>
            <StyledCard>
              <StyledLabel>禁止成员使用密码登录</StyledLabel>
              <Switch
                checked={data?.disable_password_login}
                onChange={(e) =>
                  updateSetting({ disable_password_login: e.target.checked })
                }
              />
            </StyledCard>
          </Grid>

          <Grid size={12}>
            <StyledCard sx={{ height: '100%' }}>
              <StyledLabel>
                第三方登录
                <Box
                  component='span'
                  sx={{
                    ml: 2,
                    color: data.enable_dingtalk_oauth ? 'success.main' : 'gray',
                    fontWeight: 400,
                    fontSize: 13,
                  }}
                >
                  {data.enable_dingtalk_oauth ? '已开启钉钉登录' : '未开启'}
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
          </Grid>

          <Grid size={12}>
            <LoginHistory />
          </Grid>
        </Grid>
      </Grid>

      <ThirdPartyLoginSettingModal
        open={thirdPartyLoginSettingModalOpen}
        onCancel={() => setThirdPartyLoginSettingModalOpen(false)}
        settingData={data}
        onOk={() => {
          refresh();
        }}
      />
    </Stack>
  );
};

export default User;
