import {
  ConstsAIEmployeePosition,
  ConstsRepoPlatform,
  DomainAIEmployee,
  DomainUpdateAIEmployeeReq,
  postAiemployeeCreate,
  putAiemployeeUpdate,
  postUserAiemployeeCreate,
  putUserAiemployeeUpdate,
} from '@/api';
import { Ellipsis, message, Modal } from '@ctzhian/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';
import CopyToClipboard from 'react-copy-to-clipboard';
import { Controller, useForm } from 'react-hook-form';
import { useLocation } from 'react-router-dom';
import { z } from 'zod';

const formSchema = z.object({
  issue_at_comment: z.boolean().default(false),
  /** 是否处理新Issues */
  issue_open: z.boolean().default(false),
  /** 是否mr/pr在评论中@工程师 */
  mr_pr_at_comment: z.boolean().default(false),
  /** 是否处理全部新增PR/MR */
  mr_pr_open: z.boolean().default(false),
  name: z.string().min(1, '必填项').default(''),
  platform: z
    .enum(ConstsRepoPlatform)
    .default(ConstsRepoPlatform.RepoPlatformGitLab),
  position: z
    .enum(ConstsAIEmployeePosition)
    .default(ConstsAIEmployeePosition.AIEmployeePositionEngineer),
  repo_url: z.string().min(1, '必填项').default(''),
  token: z.string().min(1, '必填项').default(''),
});

const EmloyeeModal = ({
  open,
  onClose,
  onChanged, // 添加一个回调函数，用于在创建成功后刷新列表
  record,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void; // 可选的回调函数
  record?: DomainUpdateAIEmployeeReq;
}) => {
  const [webhookOpen, setWebhookOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<
    Pick<DomainAIEmployee, 'webhook_url' | 'webhook_secret'> | undefined
  >();
  const { pathname } = useLocation();
  const isUser = pathname.startsWith('/user/');
  const {
    reset,
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: formSchema.parse({}),
  });
  const handleChange = handleSubmit(
    async (data) => {
      const res = await (record
        ? (isUser ? putUserAiemployeeUpdate : putAiemployeeUpdate)({
            ...data,
            id: record.id,
          })
        : (isUser ? postUserAiemployeeCreate : postAiemployeeCreate)(data));
      onChanged?.(); // 调用回调函数，刷新列表
      setWebhookUrl(res);
      setWebhookOpen(true);
    },
    (e) => {
      console.log(e);
    }
  );
  const checkitems = [
    { key: 'issue_open', label: '自动跟进所有的 Issue' },
    { key: 'mr_pr_open', label: '自动跟进所有的 Merge/Pull Request' },
    { key: 'issue_at_comment', label: '允许在 Issue 中被 @' },
    { key: 'mr_pr_at_comment', label: '允许在 Merge/Pull Request 中被 @' },
  ] as const;
  useEffect(() => {
    if (open) reset(record || formSchema.parse({}));
  }, [record, reset, open]);
  const onCloseWebhook = () => {
    setWebhookOpen(false);
    setWebhookUrl(undefined);
  };
  return (
    <>
      <Modal
        title={record ? '编辑 AI 员工' : '创建 AI 员工'}
        width={600}
        open={open}
        // onOk={() => setOpenWebhook(true)}
        onOk={handleChange}
        onCancel={onClose}
        okText={record ? '更新' : '创建'}
        cancelText='取消'
      >
        <Stack spacing={2} sx={{ fontSize: '13px' }}>
          <TextField
            label='AI 员工名称'
            fullWidth
            size='small'
            {...register('name')}
            error={!!errors.name}
            helperText={errors.name?.message}
          />
          <Stack
            direction={'row'}
            component={FormControl}
            alignItems='center'
            spacing={3}
          >
            <FormLabel id='demo-row-radio-buttons-group-label'>
              AI 员工角色
            </FormLabel>
            <Controller
              control={control}
              name='position'
              render={({ field }) => (
                <RadioGroup
                  row
                  value={field.value}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                  }}
                >
                  {[
                    ConstsAIEmployeePosition.AIEmployeePositionEngineer,
                    ConstsAIEmployeePosition.AIEmployeePositionTester,
                    ConstsAIEmployeePosition.AIEmployeePositionProductManager,
                  ].map((item) => (
                    <FormControlLabel
                      key={item}
                      value={item}
                      control={<Radio />}
                      label={item}
                      disabled={
                        item !==
                        ConstsAIEmployeePosition.AIEmployeePositionEngineer
                      }
                    />
                  ))}
                </RadioGroup>
              )}
            />
          </Stack>
          <FormGroup>
            {checkitems.map((item) => (
              <Controller
                key={item.key}
                control={control}
                name={item.key}
                render={({ field }) => (
                  <FormControlLabel
                    sx={{ mt: -2 }}
                    control={<Checkbox {...field} checked={field.value} />}
                    label={item.label}
                  />
                )}
              />
            ))}
          </FormGroup>
          <TextField
            label='工作项目的 Git 仓库'
            fullWidth
            size='small'
            {...register('repo_url')}
            error={!!errors.repo_url}
            helperText={errors.repo_url?.message}
          />
          <Stack
            direction={'row'}
            component={FormControl}
            alignItems='center'
            spacing={3}
          >
            <FormLabel id='demo-row-radio-buttons-group-label'>
              Git 托管平台
            </FormLabel>
            <Controller
              control={control}
              name='platform'
              render={({ field }) => (
                <RadioGroup
                  row
                  value={field.value}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                  }}
                >
                  {[
                    ConstsRepoPlatform.RepoPlatformGitHub,
                    ConstsRepoPlatform.RepoPlatformGitLab,
                    ConstsRepoPlatform.RepoPlatformGitee,
                    ConstsRepoPlatform.RepoPlatformGitea,
                  ].map((item) => (
                    <FormControlLabel
                      key={item}
                      value={item}
                      control={<Radio />}
                      label={item}
                      disabled={item !== ConstsRepoPlatform.RepoPlatformGitLab && item !== ConstsRepoPlatform.RepoPlatformGitHub}
                    />
                  ))}
                </RadioGroup>
              )}
            />
          </Stack>
          <TextField
            label='Git 仓库的访问令牌'
            fullWidth
            size='small'
            {...register('token')}
            error={!!errors.token}
            helperText={errors.token?.message}
          />
        </Stack>
      </Modal>
      <Modal
        title='Webhook 配置信息'
        width={830}
        open={webhookOpen}
        onOk={onCloseWebhook}
        onCancel={onCloseWebhook}
        showCancel={false}
        okText='确定'
      >
        {webhookUrl?.webhook_secret && (
          <Stack
            spacing={2}
            sx={{
              mt: 2,
              fontSize: '14px',
              '& > .MuiStack-root > div:nth-child(2)': {
                fontWeight: 600,
                bgcolor: 'background.paper',
                px: 1,
                py: 0.5,
                borderRadius: '4px',
              },
            }}
          >
            <Stack direction='row' alignItems={'center'} spacing={2}>
              <Box sx={{ flexShrink: 0, minWidth: '130px' }}>Webhook URL: </Box>
              <Ellipsis>{webhookUrl?.webhook_url}</Ellipsis>
              <CopyToClipboard
                text={webhookUrl?.webhook_url || ''}
                onCopy={() => {
                  message.success('复制成功');
                }}
              >
                <IconButton
                  color='primary'
                  size='small'
                  sx={{ alignSelf: 'flex-end' }}
                >
                  <ContentCopyIcon />
                </IconButton>
              </CopyToClipboard>
            </Stack>
            <Stack direction='row' alignItems={'center'} spacing={2}>
              <Box sx={{ flexShrink: 0, minWidth: '130px' }}>
                Webhook Secret:{' '}
              </Box>
              <Ellipsis>{webhookUrl?.webhook_secret}</Ellipsis>
              <CopyToClipboard
                text={webhookUrl?.webhook_secret || ''}
                onCopy={() => {
                  message.success('复制成功');
                }}
              >
                <IconButton
                  color='primary'
                  size='small'
                  sx={{ alignSelf: 'flex-end' }}
                >
                  <ContentCopyIcon />
                </IconButton>
              </CopyToClipboard>
            </Stack>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default EmloyeeModal;
