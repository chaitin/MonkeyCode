import React, { useState } from 'react';
import Card from '@/components/card';
import {
  deleteDeleteModel,
  putUpdateModel,
} from '@/api/Model';
import { DomainModel, GithubComChaitinMonkeyCodeBackendConstsModelStatus, GithubComChaitinMonkeyCodeBackendConstsModelType, } from '@/api/types';
import { Stack, Box, Button, Grid2 as Grid, ButtonBase } from '@mui/material';
import { Icon, Modal, message } from '@c-x/ui';
import { addCommasToNumber } from '@/utils';
import NoData from '@/assets/images/nodata.png';
import { ModelModal, DEFAULT_MODEL_PROVIDERS} from '@yokowu/modelkit-ui';
import { localModelToModelKitModel, modelService } from '@/pages/model/components/services/modelService';

const ModelItem = ({
  data,
  onEdit,
  refresh,
}: {
  data: DomainModel;
  onEdit: (data: DomainModel) => void;
  refresh: () => void;
}) => {
  const onInactiveModel = () => {
    Modal.confirm({
      title: '停用模型',
      content: (
        <>
          确定要停用{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {data.model_name}
          </Box>{' '}
          模型吗？
        </>
      ),
      okText: '停用',
      okButtonProps: {
        color: 'error',
      },
      onOk: () => {
        putUpdateModel({
          id: data.id,
          status: GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusInactive,
          provider: data.provider!,
        }).then(() => {
          message.success('停用成功');
          refresh();
        });
      },
    });
  };

  const onRemoveModel = () => {
    Modal.confirm({
      title: '删除模型',
      content: (
        <>
          确定要删除{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {data.model_name}
          </Box>{' '}
          模型吗？
        </>
      ),
      okText: '删除',
      okButtonProps: {
        color: 'error',
      },
      onOk: () => {
        deleteDeleteModel({ id: data.id! }).then(() => {
          message.success('删除成功');
          refresh();
        });
      },
    });
  };

  const onSetDefaultModel = () => {
    Modal.confirm({
      title: '设为默认模型',
      content: (
        <>
          确定要设置{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {data.model_name}
          </Box>{' '}
          为默认模型吗？
        </>
      ),
      onOk: () => {
        putUpdateModel({
          id: data.id,
          status: GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusDefault,
          provider: data.provider!,
        }).then(() => {
          message.success('设为默认模型成功');
          refresh();
        });
      },
    });
  };

  const onActiveModel = () => {
    Modal.confirm({
      title: '激活模型',
      content: (
        <>
          确定要激活{' '}
          <Box component='span' sx={{ fontWeight: 700, color: 'text.primary' }}>
            {data.model_name}
          </Box>{' '}
          模型吗？
        </>
      ),
      onOk: () => {
        putUpdateModel({
          id: data.id,
          status: GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusActive,
          provider: data.provider!,
        }).then(() => {
          message.success('激活成功');
          refresh();
        });
      },
    });
  };

  // 添加状态标签渲染函数
  const renderStatusLabel = () => {
    // 根据 is_active 和 status 字段判断状态
    if (data.is_active && data.status === GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusActive) {
      return (
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            backgroundColor: 'success.main',
            color: 'success.contrastText',
            borderRadius: '0 0 0 8px', // 左下角圆角，贴合卡片右上角
            fontSize: 12,
            fontWeight: 600,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            position: 'relative',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              right: 0,
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderTop: '6px solid',
              borderTopColor: 'success.dark',
            }
          }}
        >
          可选
        </Box>
      );
    } else if (data.status === GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusInactive) {
      return (
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            backgroundColor: 'grey.400',
            color: 'grey.50',
            borderRadius: '0 0 0 8px',
            fontSize: 12,
            fontWeight: 600,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            position: 'relative',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              right: 0,
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderTop: '6px solid',
              borderTopColor: 'grey.600',
            }
          }}
        >
          未激活
        </Box>
      );
    } else {
      // 默认状态
      return (
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            borderRadius: '0 0 0 8px',
            fontSize: 12,
            fontWeight: 600,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            position: 'relative',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              right: 0,
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderTop: '6px solid',
              borderTopColor: 'primary.dark',
            }
          }}
        >
          默认
        </Box>
      );
    }
  };

  return (
    <Card
      sx={{
        overflow: 'hidden',
        position: 'relative',
        transition: 'all 0.3s ease',
        borderStyle: 'solid',
        borderWidth: '1px',
        borderColor: 'transparent',
        boxShadow:
          '0px 0px 10px 0px rgba(68, 80, 91, 0.1), 0px 0px 2px 0px rgba(68, 80, 91, 0.1)',
        '&:hover': {
          boxShadow:
            'rgba(54, 59, 76, 0.3) 0px 10px 30px 0px, rgba(54, 59, 76, 0.03) 0px 0px 1px 1px',
        },
      }}
    >
      {/* 美化的右上角状态标签 */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          right: 0,
          zIndex: 2,
        }}
      >
        {renderStatusLabel()}
      </Box>

      <Stack
        direction='row'
        alignItems='center'
        justifyContent='space-between'
        sx={{ height: 28 }}
      >
        <Stack direction='row' alignItems='center' gap={1}>
          <Icon
            type={
              DEFAULT_MODEL_PROVIDERS[data.provider as keyof typeof DEFAULT_MODEL_PROVIDERS]?.icon
            }
            sx={{ fontSize: 24, color: data.is_active ? 'inherit' : 'grey.400' }}
          />
          <Stack
            direction='row'
            alignItems='center'
            gap={1}
            sx={{ fontSize: 14, minWidth: 0 }}
          >
            <Box
              sx={{
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: data.is_active ? 'inherit' : 'grey.400',
              }}
            >
              {data.show_name || '未命名'}
            </Box>
            <Box
              sx={{
                color: 'text.tertiary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              / {data.model_name}
            </Box>
          </Stack>
        </Stack>
      </Stack>
      <Stack
        gap={1}
        sx={{
          mt: 3,
          pb: 2,
          borderBottom: '1px dashed',
          borderColor: 'divider',
        }}
      >
        <Stack
          direction='row'
          alignItems='center'
          justifyContent='space-between'
          sx={{ fontSize: 14 }}
        >
          <Box sx={{ color: 'text.tertiary' }}>输入 Token 使用量</Box>
          <Box sx={{ fontWeight: 700 }}>{addCommasToNumber(data.input)}</Box>
        </Stack>
        <Stack
          direction='row'
          alignItems='center'
          justifyContent='space-between'
          sx={{ fontSize: 14 }}
        >
          <Box sx={{ color: 'text.tertiary' }}>输出 Token 使用量</Box>
          <Box sx={{ fontWeight: 700 }}>{addCommasToNumber(data.output)}</Box>
        </Stack>
      </Stack>
      <Stack
        direction='row'
        justifyContent='space-between'
        alignItems='center'
        gap={2}
        sx={{ mt: 2 }}
      >
        <Stack direction='row' alignItems='center'> </Stack>
        <Stack direction='row' sx={{ button: { minWidth: 0 } }} gap={2}>
          {(data.status === GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusActive ||
          data.status === GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusInactive) && (
            <ButtonBase
              disableRipple
              sx={{
                color: 'text.primary',
                '&:hover': {
                  fontWeight: 700
                },
              }}
              onClick={onSetDefaultModel}
            >
              设为默认
            </ButtonBase>
          )}

          {data.status === GithubComChaitinMonkeyCodeBackendConstsModelStatus.ModelStatusInactive && (
            <ButtonBase
              disableRipple
              sx={{
                color: 'success.main',
                '&:hover': {
                  fontWeight: 700
                },
              }}
              onClick={onActiveModel}
            >
              激活
            </ButtonBase>
          )}

          {!data.is_internal && (
            <ButtonBase
              disableRipple
              sx={{
                color: 'info.main',
                '&:hover': {
                  fontWeight: 700
                },
              }}
              onClick={() => onEdit(data)}
            >
              编辑
            </ButtonBase>
          )}

          {data.is_active && (
            <ButtonBase
              disableRipple
              sx={{
                color: 'error.main',
                '&:hover': {
                  fontWeight: 700
                },
              }}
              onClick={onInactiveModel}
            >
              停用
            </ButtonBase>
          )}

          {data.is_internal === false && data.is_active === false && (
            <ButtonBase
              disableRipple
              sx={{
                color: 'error.main',
                '&:hover': {
                  fontWeight: 700
                },
              }}
              onClick={onRemoveModel}
            >
              删除
            </ButtonBase>
          )}
        </Stack>
      </Stack>
    </Card>
  );
};

interface IModelCardProps {
  title: string;
  modelType: GithubComChaitinMonkeyCodeBackendConstsModelType;
  data: DomainModel[];
  refreshModel: () => void;
}

const ModelCard: React.FC<IModelCardProps> = ({
  title,
  modelType,
  data,
  refreshModel,
}) => {
  const [open, setOpen] = useState(false);
  const [editData, setEditData] = useState<DomainModel | null>(null);

  const onEdit = (data: DomainModel) => {
    setOpen(true);
    setEditData(data);
  };

  return (
    <Card>
      <Stack direction='row' justifyContent='space-between' alignItems='center'>
        <Box sx={{ fontWeight: 700 }}>{title}</Box>
        <Button
          variant='contained'
          color='primary'
          onClick={() => setOpen(true)}
        >
          添加模型
        </Button>
      </Stack>
      {data?.length > 0 ? (
        <Grid container spacing={2} sx={{ mt: 2 }}>
          {data.map((item) => (
            <Grid size={{ lg: 12, xl: 6 }} key={item.id}>
              <ModelItem data={item} onEdit={onEdit} refresh={refreshModel} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Stack alignItems={'center'} sx={{ my: 2 }}>
          <img src={NoData} width={150} alt='empty' />
          <Box sx={{ color: 'error.main', fontSize: 12 }}>
            暂无模型，请先添加模型
          </Box>
        </Stack>
      )}

      <ModelModal
        open={open}
        onClose={() => {
          setOpen(false);
          setEditData(null);
        }}
        refresh={refreshModel}
        data={editData ? localModelToModelKitModel(editData) : null}
        model_type={modelType}
        modelService={modelService}
        language="zh-CN"
        messageComponent={message}
      />
    </Card>
  );
};

export default ModelCard;
