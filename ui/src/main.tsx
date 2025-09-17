import ReactDOM from 'react-dom/client';
import { useState, useEffect } from 'react';
import 'dayjs/locale/zh-cn';
import { RouterProvider } from 'react-router-dom';
import '@/assets/fonts/font.css';
import '@/assets/fonts/iconfont';
import './index.css';
import '@/assets/styles/markdown.css';
import { ThemeProvider } from '@ctzhian/ui';
import { zhCN } from 'date-fns/locale/zh-CN';
import { setDefaultOptions } from 'date-fns';

// 配置 Monaco Editor 环境
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

window.MonacoEnvironment = {
  getWorker: function (workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};
import { getUserProfile } from '@/api/UserManage';
import { getAdminProfile } from '@/api/Admin';
import { getMyModelList } from '@/api/Model';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import { AuthContext, CommonContext } from './context';
import { DomainUser, DomainAdminUser, DomainModel } from './api/types';
import { lightTheme } from './theme';
import router from './router';
import { getRedirectUrl } from './utils';

dayjs.locale('zh-cn');
dayjs.extend(duration);
dayjs.extend(relativeTime);
setDefaultOptions({ locale: zhCN });
const App = () => {
  const [user, setUser] = useState<DomainUser | DomainAdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelLoading, setModelLoading] = useState(true);
  const [coderModel, setCoderModel] = useState<DomainModel[]>([]);
  const [llmModel, setLlmModel] = useState<DomainModel[]>([]);
  const [isConfigModel, setIsConfigModel] = useState(false);

  const onGotoRedirect = (source: 'user' | 'admin') => {
    const redirectUrl = getRedirectUrl(source);
    window.location.href = redirectUrl.href;
  };

  const getModelList = () => {
    setModelLoading(true);
    return Promise.all([
      getMyModelList({
        model_type: 'coder',
      }),
      getMyModelList({
        model_type: 'llm',
      }),
    ])
      .then((res) => {
        setCoderModel(res[0] || []);
        setLlmModel(res[1] || []);
        return res;
      })
      .then(handleModelConfig)
      .finally(() => {
        setModelLoading(false);
      });
  };

  const handleModelConfig = (res: [DomainModel[], DomainModel[]]) => {
    if ((res[0] || [])?.length == 0 || (res[1] || [])?.length == 0) {
      if (location.pathname !== '/general-setting') {
        window.location.href = '/general-setting';
      }
      setIsConfigModel(false);
      return false;
    } else {
      const isActive =
        res[0].some((item) => item.is_active) &&
        res[1].some((item) => item.is_active);
      if (isActive) {
        setIsConfigModel(true);
        return true;
      } else {
        if (location.pathname !== '/general-setting') {
          window.location.href = '/general-setting';
        }
        setIsConfigModel(false);
        return false;
      }
    }
  };

  const getUser = () => {
    setLoading(true);
    if (
      location.pathname.startsWith('/user') ||
      location.pathname === '/login' ||
      location.pathname === '/login/user'
    ) {
      return getUserProfile()
        .then((res) => {
          setUser(res);
          if (location.pathname.startsWith('/login')) {
            onGotoRedirect('user');
          }
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (
      !location.pathname.startsWith('/auth') ||
      !location.pathname.startsWith('/user') ||
      location.pathname === '/login/admin'
    ) {
      return getAdminProfile()
        .then((res) => {
          setUser(res);
          getModelList().then((res) => {
            if (res) {
              if (location.pathname.startsWith('/login')) {
                onGotoRedirect('admin');
              }
            }
          });
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  };

  useEffect(() => {
    getUser();
  }, []);

  if (loading) {
    return null;
  }

  return (
    <ThemeProvider theme={lightTheme}>
      <CommonContext.Provider
        value={{
          coderModel,
          llmModel,
          modelLoading,
          isConfigModel,
          refreshModel: getModelList,
        }}
      >
        <AuthContext.Provider
          value={[
            user,
            {
              loading,
              setUser,
              refreshUser: getUser,
            },
          ]}
        >
          <RouterProvider router={router} />
        </AuthContext.Provider>
      </CommonContext.Provider>
    </ThemeProvider>
  );
};

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(<App />);
