import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { obtainCaptchaToken } from '@/api/captcha';
import {
  DEFAULT_BASE_URL,
  getUserStatus,
  login as apiLogin,
  logout as apiLogout,
  setBaseUrl,
  setBasicAuth,
  setUnauthorizedHandler,
} from '@/api/client';
import type { UserStatus } from '@/api/types';

const STORAGE_BASE_URL = 'mc.baseUrl';
const STORAGE_EMAIL = 'mc.email';
const STORAGE_PASSWORD = 'mc.pw';
const STORAGE_BASIC_AUTH = 'mc.basicAuth';
const STORAGE_LOGGED_IN = 'mc.loggedIn';

interface AuthState {
  ready: boolean; // 启动恢复完成
  authenticated: boolean;
  user: UserStatus | null;
  baseUrl: string;
  basicAuth: string; // 测试环境的 HTTP Basic Auth（"user:pass"），可选
  savedEmail: string;
  savedPassword: string; // 上次登录成功的密码，用于自动填充
  login: (email: string, password: string) => Promise<void>;
  completeOAuthLogin: () => Promise<void>; // 百智云 OAuth 在 WebView 完成后，用会话 Cookie 确认登录
  logout: () => Promise<void>;
  updateBaseUrl: (url: string) => Promise<void>;
  updateBasicAuth: (v: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<UserStatus | null>(null);
  const [baseUrl, setBaseUrlState] = useState(DEFAULT_BASE_URL);
  const [basicAuth, setBasicAuthState] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [savedPassword, setSavedPassword] = useState('');

  const doLogout = useCallback(async () => {
    // 先清掉本地登录态与用户信息，再让后端失效会话；
    // 否则残留的会话 Cookie 会被下一次（尤其是百智云）登录沿用，导致用户信息串号。
    setAuthenticated(false);
    setUser(null);
    await AsyncStorage.setItem(STORAGE_LOGGED_IN, '0');
    await apiLogout();
  }, []);

  // 401 时自动退出登录态
  useEffect(() => {
    setUnauthorizedHandler(() => {
      AsyncStorage.setItem(STORAGE_LOGGED_IN, '0').catch(() => undefined);
      setAuthenticated(false);
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // 启动恢复：读取 baseUrl / email，并尝试用现有 Cookie 验证会话
  useEffect(() => {
    (async () => {
      try {
        const [storedBase, storedBasic, storedEmail, storedPassword, loggedIn] = await Promise.all([
          AsyncStorage.getItem(STORAGE_BASE_URL),
          AsyncStorage.getItem(STORAGE_BASIC_AUTH),
          AsyncStorage.getItem(STORAGE_EMAIL),
          AsyncStorage.getItem(STORAGE_PASSWORD),
          AsyncStorage.getItem(STORAGE_LOGGED_IN),
        ]);
        const url = storedBase || DEFAULT_BASE_URL;
        setBaseUrl(url);
        setBaseUrlState(url);
        // 先装好 Basic Auth，后面的 getUserStatus 才能穿过测试环境的代理
        setBasicAuth(storedBasic || '');
        setBasicAuthState(storedBasic || '');
        if (storedEmail) setSavedEmail(storedEmail);
        if (storedPassword) setSavedPassword(storedPassword);

        if (loggedIn === '1') {
          try {
            const u = await getUserStatus();
            if (u && (u.id || u.email || u.username)) {
              setUser(u);
              setAuthenticated(true);
            }
          } catch {
            // 会话失效，保持未登录
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const captchaToken = await obtainCaptchaToken(baseUrl);
      await apiLogin(email.trim(), password, captchaToken);
      // 登录成功后拉取用户信息
      let u: UserStatus = {};
      try {
        u = await getUserStatus();
      } catch {
        /* 忽略，仍视为已登录 */
      }
      await AsyncStorage.multiSet([
        [STORAGE_LOGGED_IN, '1'],
        [STORAGE_EMAIL, email.trim()],
        [STORAGE_PASSWORD, password],
      ]);
      setSavedEmail(email.trim());
      setSavedPassword(password);
      setUser(u);
      setAuthenticated(true);
    },
    [baseUrl],
  );

  // 百智云 OAuth：WebView 跑完整个授权流程后，后端已写入会话 Cookie（原生网络层与
  // WebView 共享 Cookie 存储）。这里用 Cookie 拉一次用户信息确认登录成功。
  const completeOAuthLogin = useCallback(async () => {
    const u = await getUserStatus();
    if (!u || !(u.id || u.email || u.username)) {
      throw new Error('登录未完成');
    }
    // 只建立会话 + 当前用户信息；不动登录表单的自动填充凭据（那是另一回事）。
    await AsyncStorage.setItem(STORAGE_LOGGED_IN, '1');
    setUser(u);
    setAuthenticated(true);
  }, []);

  const updateBaseUrl = useCallback(async (url: string) => {
    const clean = url.replace(/\/+$/, '');
    setBaseUrl(clean);
    setBaseUrlState(clean);
    await AsyncStorage.setItem(STORAGE_BASE_URL, clean);
  }, []);

  const updateBasicAuth = useCallback(async (v: string) => {
    const clean = (v || '').trim();
    setBasicAuth(clean);
    setBasicAuthState(clean);
    await AsyncStorage.setItem(STORAGE_BASIC_AUTH, clean);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      authenticated,
      user,
      baseUrl,
      basicAuth,
      savedEmail,
      savedPassword,
      login,
      completeOAuthLogin,
      logout: doLogout,
      updateBaseUrl,
      updateBasicAuth,
    }),
    [ready, authenticated, user, baseUrl, basicAuth, savedEmail, savedPassword, login, completeOAuthLogin, doLogout, updateBaseUrl, updateBasicAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
