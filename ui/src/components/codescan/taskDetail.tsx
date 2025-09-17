import Card from '@/components/card';
import { Ellipsis, Modal } from '@ctzhian/ui';

import { useEffect, useRef, useState } from 'react';

import {
  DomainSecurityScanningResult,
  DomainSecurityScanningRiskDetail,
} from '@/api/types';
import {
  getSecurityScanningDetail,
  getUserSecurityScanningDetail,
} from '@/api';
import {
  Box,
  CircularProgress,
  Grid,
  List,
  ListItem,
  ListItemButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import MonacoEditor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

interface RiskLevelBoxProps {
  level: 'severe' | 'critical' | 'suggest';
}

const RiskLevelBox = ({ level }: RiskLevelBoxProps) => {
  const riskConfig = {
    severe: {
      text: '严重',
      color: 'risk.severe',
    },
    critical: {
      text: '高风险',
      color: 'risk.critical',
    },
    suggest: {
      text: '低风险',
      color: 'risk.suggest',
    },
  };

  const config = riskConfig[level];

  if (!config) return null;

  return (
    <Box
      sx={{
        backgroundColor: config.color,
        color: '#fff',
        borderRadius: '4px',
        textAlign: 'center',
        width: '80px',
        minWidth: '80px',
        fontSize: '12px',
        lineHeight: '20px',
      }}
    >
      {config.text}
    </Box>
  );
};

const getLanguageByFilename = (filename: string = ''): string => {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    pyw: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    php3: 'php',
    php4: 'php',
    php5: 'php',
    phtml: 'php',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    sh: 'shell',
    bash: 'shell',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    vue: 'vue',
    svelte: 'svelte',
  };

  return languageMap[extension] || 'plaintext';
};

const TaskDetail = ({
  task,
  open,
  onClose,
  admin,
}: {
  task?: DomainSecurityScanningResult;
  open: boolean;
  onClose: () => void;
  admin: boolean;
}) => {
  const [loading, setLoading] = useState(true);
  const [vulns, setVulns] = useState<DomainSecurityScanningRiskDetail[]>([]);
  const [vulDetail, setVulDetail] = useState<
    DomainSecurityScanningRiskDetail | undefined
  >(undefined);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('detail');

  const fetchData = async () => {
    setLoading(true);
    const resp = await (admin
      ? getSecurityScanningDetail
      : getUserSecurityScanningDetail)({
      id: task?.id as string,
    });
    setVulns(resp);
    setLoading(false);
  };

  useEffect(() => {
    setVulns([]);
    setVulDetail(undefined);
    setViewMode('detail');
    console.log(!!vulDetail);
    if (open) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, open]);

  // 保存编辑器实例的引用
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  // 监听 vulDetail 的变化，重新高亮显示
  useEffect(() => {
    if (editorRef.current) {
      highlightVulnerability(editorRef.current, vulDetail);
    }
  }, [vulDetail]);

  // 高亮显示漏洞代码
  const highlightVulnerability = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    vulDetail: DomainSecurityScanningRiskDetail | undefined
  ) => {
    // 清除之前的装饰器
    editor.deltaDecorations(
      editor
        .getModel()
        ?.getAllDecorations()
        .map((d) => d.id) || [],
      []
    );

    // 如果有 start 和 end 位置信息，则设置选区
    if (vulDetail?.start && vulDetail?.end) {
      const startLine = vulDetail.start.line ?? 1;
      const startColumn = vulDetail.start.col ?? 1;
      const endLine = vulDetail.end.line ?? startLine;
      const endColumn = vulDetail.end.col ?? startColumn;

      // 设置选区
      const selection = {
        startLineNumber: startLine,
        startColumn: startColumn,
        endLineNumber: endLine,
        endColumn: endColumn,
      };

      editor.setSelection(selection);

      // 添加装饰器以增强高亮效果
      editor.deltaDecorations(
        [],
        [
          {
            range: selection,
            options: {
              isWholeLine: false,
              className: 'highlighted-code',
              inlineClassName: 'highlighted-code-inline',
              overviewRuler: {
                color: 'rgba(255, 255, 0, 0.5)',
                position: 1, // Monaco.Editor.OverviewRulerLane.Center
              },
            },
          },
        ]
      );

      // 滚动到选区
      editor.revealLineInCenter(startLine);
    }
  };

  const handleEditorDidMount = (
    editor: Monaco.editor.IStandaloneCodeEditor
  ) => {
    // 保存编辑器实例
    editorRef.current = editor;

    // 初始高亮
    highlightVulnerability(editor, vulDetail);
  };

  return (
    <Modal
      title={
        <Stack direction={'row'}>
          {vulDetail && (
            <ToggleButtonGroup
              exclusive
              value={viewMode}
              size='small'
              onChange={(e, value) => {
                setViewMode(value);
              }}
            >
              <ToggleButton value='list'>
                <ListAltIcon />
              </ToggleButton>
              <ToggleButton value='detail' disabled={!vulDetail}>
                <ViewSidebarOutlinedIcon sx={{ transform: 'rotate(180deg)' }} />
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          <Ellipsis
            sx={{
              fontWeight: 'bold',
              fontSize: 20,
              lineHeight: '40px',
              width: 700,
              ml: '20px',
            }}
          >
            {task?.name} / {task?.project_name}
          </Ellipsis>
        </Stack>
      }
      width={1200}
      open={open}
      onCancel={onClose}
      footer={null}
    >
      <Card sx={{ p: 0, background: 'transparent', boxShadow: 'none' }}>
        <Grid container sx={{ height: '70vh' }}>
          <Grid
            size={viewMode === 'detail' && !!vulDetail ? 5 : 12}
            sx={{
              height: '100%',
              overflow: 'auto',
            }}
          >
            <List>
              {loading ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '20px',
                  }}
                >
                  <CircularProgress />
                </div>
              ) : (
                vulns.map((vuln) => (
                  <ListItem
                    key={vuln.id}
                    sx={{
                      padding: 0,
                      width: '100%',
                    }}
                  >
                    <ListItemButton
                      selected={vulDetail?.id === vuln.id}
                      onClick={() => {
                        setVulDetail(vuln);
                      }}
                      sx={{
                        borderBottomWidth: '1px',
                        borderBottomStyle: 'solid',
                        borderBottomColor: 'background.paper',
                        fontSize: '14px',
                        width: '100%',
                      }}
                    >
                      <Stack
                        direction={'column'}
                        sx={{
                          width: '100%',
                        }}
                      >
                        <Stack direction={'row'}>
                          <RiskLevelBox
                            level={
                              vuln.level as 'severe' | 'critical' | 'suggest'
                            }
                          />
                          <Box
                            sx={{
                              fontSize: '14px',
                              ml: '20px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              lineHeight: '20px',
                            }}
                          >
                            {vuln.desc}
                          </Box>
                        </Stack>
                        <Box
                          sx={{
                            color: 'text.tertiary',
                            fontSize: '14px',
                            mt: '6px',
                            width: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {vuln.filename}:{vuln?.start?.line}
                        </Box>

                        {!!vulDetail && vulDetail?.id === vuln.id && (
                          <Box
                            sx={{
                              fontSize: '12px',
                              mt: '6px',
                            }}
                          >
                            关键代码位于第 {vulDetail?.start?.line} 行
                            {vulDetail?.start?.line !== vulDetail?.end?.line &&
                              `至第 ${vulDetail?.end?.line} 行`}
                          </Box>
                        )}
                        {!!vulDetail && vulDetail?.id === vuln.id && (
                          <Box
                            sx={{
                              fontSize: '12px',
                              mt: '6px',
                            }}
                          >
                            <pre
                              style={{
                                backgroundColor: '#fff',
                                padding: '10px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                overflow: 'hidden',
                              }}
                            >
                              {vulDetail?.lines}
                            </pre>
                          </Box>
                        )}
                        {!!vulDetail && vulDetail?.id === vuln.id && (
                          <Box
                            sx={{
                              fontSize: '12px',
                              mt: '6px',
                            }}
                          >
                            修改建议：{vulDetail?.fix}
                          </Box>
                        )}
                      </Stack>
                    </ListItemButton>
                  </ListItem>
                ))
              )}
            </List>
          </Grid>
          {viewMode === 'detail' && !!vulDetail && (
            <Grid
              size={7}
              sx={{
                height: '100%',
                overflow: 'auto',
              }}
            >
              <Box
                sx={{
                  width: '100%',
                  height: '100%',
                }}
              >
                <style>
                  {' '}
                  {`.monaco-editor.vs-dark .highlighted-code { background-color: rgba(255, 0, 0, 0.3) !important; }`}{' '}
                </style>
                <MonacoEditor
                  height='100%'
                  value={vulDetail?.content || ''}
                  theme='vs-dark'
                  language={getLanguageByFilename(vulDetail?.filename)}
                  options={{
                    readOnly: true,
                    minimap: {
                      enabled: false,
                    },
                  }}
                  onMount={handleEditorDidMount}
                ></MonacoEditor>
              </Box>
            </Grid>
          )}
        </Grid>
      </Card>
    </Modal>
  );
};

export default TaskDetail;
