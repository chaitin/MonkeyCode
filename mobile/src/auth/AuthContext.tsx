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
  loginBaizhiDouyinApp as apiLoginBaizhiDouyinApp,
  loginBaizhiPhone as apiLoginBaizhiPhone,
  sendBaizhiPhoneCode as apiSendBaizhiPhoneCode,
} from '@/api/baizhi';
import {
  appleLogin as apiAppleLogin,
  deleteAccount as apiDeleteAccount,
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
const STORAGE_BAIZHI_PHONE = 'mc.baizhiPhone';
const STORAGE_BASIC_AUTH = 'mc.basicAuth';
const STORAGE_LOGGED_IN = 'mc.loggedIn';
const STORAGE_APPLE_LOGIN = 'mc.appleLogin'; // 当前登录态是否来自 Apple 登录（注销账号入口只对 Apple 账号开放）

interface AuthState {
  ready: boolean; // 启动恢复完成
  authenticated: boolean;
  appleSession: boolean; // 当前登录态是否来自 Apple 登录
  user: UserStatus | null;
  baseUrl: string;
  basicAuth: string; // 测试环境的 HTTP Basic Auth（"user:pass"），可选
  savedEmail: string;
  savedPassword: string; // 上次登录成功的密码，用于自动填充
  savedPhone: string;
  refreshUser: () => Promise<UserStatus>;
  login: (email: string, password: string, targetBaseUrl?: string) => Promise<void>;
  loginWithApple: (params: { identity_token: string; authorization_code?: string; full_name?: string }) => Promise<void>;
  startDouyinAppBaizhiLogin: (code: string) => Promise<void>;
  sendBaizhiPhoneCode: (phone: string) => Promise<void>;
  startBaizhiPhoneLogin: (phone: string, code: string) => Promise<void>;
  finishBaizhiOAuthLogin: (targetBaseUrl?: string, phoneToSave?: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>; // 注销账号：后端删除成功后清空本地登录态与保存的凭据
  updateBaseUrl: (url: string) => Promise<void>;
  updateBasicAuth: (v: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hasUserIdentity(u: UserStatus | null | undefined): u is UserStatus {
  return !!u && !!(u.id || u.email || u.username);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [appleSession, setAppleSession] = useState(false);
  const [user, setUser] = useState<UserStatus | null>(null);
  const [baseUrl, setBaseUrlState] = useState(DEFAULT_BASE_URL);
  const [basicAuth, setBasicAuthState] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [savedPassword, setSavedPassword] = useState('');
  const [savedPhone, setSavedPhone] = useState('');

  const doLogout = useCallback(async () => {
    // 先清掉本地登录态与用户信息，再让后端失效会话；
    // 否则残留的会话 Cookie 会被下一次（尤其是百智云）登录沿用，导致用户信息串号。
    setAuthenticated(false);
    setUser(null);
    setAppleSession(false);
    await AsyncStorage.setItem(STORAGE_LOGGED_IN, '0');
    await apiLogout();
  }, []);

  // 401 时自动退出登录态
  useEffect(() => {
    setUnauthorizedHandler(() => {
      AsyncStorage.setItem(STORAGE_LOGGED_IN, '0').catch(() => undefined);
      setAuthenticated(false);
      setUser(null);
      setAppleSession(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // 启动恢复：读取 baseUrl / 自动填充信息，并尝试用现有 Cookie 验证会话
  useEffect(() => {
    (async () => {
      try {
        const [storedBase, storedBasic, storedEmail, storedPassword, storedPhone, loggedIn, storedApple] = await Promise.all([
          AsyncStorage.getItem(STORAGE_BASE_URL),
          AsyncStorage.getItem(STORAGE_BASIC_AUTH),
          AsyncStorage.getItem(STORAGE_EMAIL),
          AsyncStorage.getItem(STORAGE_PASSWORD),
          AsyncStorage.getItem(STORAGE_BAIZHI_PHONE),
          AsyncStorage.getItem(STORAGE_LOGGED_IN),
          AsyncStorage.getItem(STORAGE_APPLE_LOGIN),
        ]);
        const url = storedBase || DEFAULT_BASE_URL;
        setBaseUrl(url);
        setBaseUrlState(url);
        // 先装好 Basic Auth，后面的 getUserStatus 才能穿过测试环境的代理
        setBasicAuth(storedBasic || '');
        setBasicAuthState(storedBasic || '');
        if (storedEmail) setSavedEmail(storedEmail);
        if (storedPassword) setSavedPassword(storedPassword);
        if (storedPhone) setSavedPhone(storedPhone);

        if (loggedIn === '1') {
          try {
            const u = await getUserStatus();
            if (hasUserIdentity(u)) {
              setUser(u);
              setAppleSession(storedApple === '1');
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

  const refreshUser = useCallback(async () => {
    const u = await getUserStatus();
    if (hasUserIdentity(u)) {
      setUser(u);
      setAuthenticated(true);
    }
    return u;
  }, []);

  const login = useCallback(
    async (email: string, password: string, targetBaseUrl?: string) => {
      const cleanEmail = email.trim();
      const captchaToken = await obtainCaptchaToken(targetBaseUrl || baseUrl);
      await apiLogin(cleanEmail, password, captchaToken);
      // 登录成功后拉取用户信息
      let u: UserStatus = {};
      try {
        u = await getUserStatus();
      } catch {
        /* 忽略，仍视为已登录 */
      }
      await AsyncStorage.multiSet([
        [STORAGE_LOGGED_IN, '1'],
        [STORAGE_APPLE_LOGIN, '0'],
        [STORAGE_EMAIL, cleanEmail],
        [STORAGE_PASSWORD, password],
      ]);
      setSavedEmail(cleanEmail);
      setSavedPassword(password);
      setUser(u);
      setAppleSession(false);
      setAuthenticated(true);
    },
    [baseUrl],
  );

  // Sign in with Apple：原生授权拿到 identity_token 后交给后端建会话（写 Cookie），
  // 之后与密码登录共用同一套会话机制。不保存表单自动填充凭据。
  const loginWithApple = useCallback(
    async (params: { identity_token: string; authorization_code?: string; full_name?: string }) => {
      // 后端 apple-login 直接返回用户信息，无需再多打一次 status（省一个慢网络往返）
      const resp = await apiAppleLogin(params);
      await AsyncStorage.multiSet([
        [STORAGE_LOGGED_IN, '1'],
        [STORAGE_APPLE_LOGIN, '1'],
      ]);
      setUser(resp.data ?? {});
      setAppleSession(true);
      setAuthenticated(true);
    },
    [],
  );

  const startDouyinAppBaizhiLogin = useCallback(async (code: string) => {
    await apiLoginBaizhiDouyinApp(code.trim());
  }, []);

  const sendBaizhiPhoneCode = useCallback(async (phone: string) => {
    await apiSendBaizhiPhoneCode(phone.trim());
  }, []);

  const startBaizhiPhoneLogin = useCallback(
    async (phone: string, code: string) => {
      const cleanPhone = phone.trim();
      await apiLoginBaizhiPhone(cleanPhone, code.trim());
    },
    [],
  );

  const finishBaizhiOAuthLogin = useCallback(
    async (_targetBaseUrl?: string, phoneToSave?: string) => {
      let u: UserStatus | null = null;
      let lastError: unknown;
      for (let i = 0; i < 4; i += 1) {
        try {
          const status = await getUserStatus();
          if (hasUserIdentity(status)) {
            u = status;
            break;
          }
        } catch (e) {
          lastError = e;
        }
        await sleep(250 + i * 250);
      }
      if (!u) {
        if (lastError) throw lastError;
        throw new Error('登录未完成');
      }
      const pairs: [string, string][] = [
        [STORAGE_LOGGED_IN, '1'],
        [STORAGE_APPLE_LOGIN, '0'],
      ];
      if (phoneToSave) pairs.push([STORAGE_BAIZHI_PHONE, phoneToSave]);
      await AsyncStorage.multiSet(pairs);
      if (phoneToSave) setSavedPhone(phoneToSave);
      setUser(u);
      setAppleSession(false);
      setAuthenticated(true);
    },
    [],
  );

  // 注销账号：后端删除成功后，账号已不存在——清掉保存的自动填充凭据，
  // 其余登录态清理复用 doLogout（保持与退出登录完全一致的清场顺序）。
  const deleteAccount = useCallback(async () => {
    await apiDeleteAccount();
    // 删除已成功，之后的本地清理失败不能再抛给调用方（否则会误报“注销失败”，
    // 而账号其实已经删了）；兜底保证内存登录态一定被清掉。
    try {
      setSavedEmail('');
      setSavedPassword('');
      await AsyncStorage.multiSet([
        [STORAGE_EMAIL, ''],
        [STORAGE_PASSWORD, ''],
      ]);
      await doLogout();
    } catch {
      setAuthenticated(false);
      setUser(null);
    }
  }, [doLogout]);

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
      appleSession,
      user,
      baseUrl,
      basicAuth,
      savedEmail,
      savedPassword,
      savedPhone,
      refreshUser,
      login,
      loginWithApple,
      startDouyinAppBaizhiLogin,
      sendBaizhiPhoneCode,
      startBaizhiPhoneLogin,
      finishBaizhiOAuthLogin,
      logout: doLogout,
      deleteAccount,
      updateBaseUrl,
      updateBasicAuth,
    }),
    [ready, authenticated, appleSession, user, baseUrl, basicAuth, savedEmail, savedPassword, savedPhone, refreshUser, login, loginWithApple, startDouyinAppBaizhiLogin, sendBaizhiPhoneCode, startBaizhiPhoneLogin, finishBaizhiOAuthLogin, doLogout, deleteAccount, updateBaseUrl, updateBasicAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
