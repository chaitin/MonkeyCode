import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Api,
  type DomainTeamUserInfo,
  type DomainUser,
  type GithubComChaitinMonkeyCodeBackendDomainServerConfig,
} from "@/api/Api";
import { DesktopEndpointBridge } from "@/components/desktop-endpoint-bridge";

export type ServerConfig = GithubComChaitinMonkeyCodeBackendDomainServerConfig;
export type RuntimeAuthStatus = "unknown" | "authenticated" | "anonymous";

export type RuntimeAuthState = {
  status: RuntimeAuthStatus;
  user: DomainUser | null;
  userInfo: DomainTeamUserInfo | null;
  loading: boolean;
};

type AppRuntimeContextValue = {
  serverConfig: ServerConfig | null;
  serverConfigLoading: boolean;
  auth: RuntimeAuthState;
  reloadServerConfig: () => Promise<ServerConfig | null>;
  reloadAuth: () => Promise<RuntimeAuthState>;
  reloadRuntime: () => Promise<void>;
};

const initialAuthState: RuntimeAuthState = {
  status: "unknown",
  user: null,
  userInfo: null,
  loading: true,
};

const anonymousAuthState: RuntimeAuthState = {
  status: "anonymous",
  user: null,
  userInfo: null,
  loading: false,
};

const AppRuntimeContext = createContext<AppRuntimeContextValue | null>(null);

async function requestServerConfig(): Promise<ServerConfig | null> {
  try {
    const response = await new Api().api.v1ServerConfigList();
    const body = response.data;

    if (body?.code === 0) {
      return body.data || null;
    }
  } catch {
    return null;
  }

  return null;
}

async function requestAuthState(): Promise<RuntimeAuthState> {
  try {
    const response = await new Api().api.v1UsersStatusList();
    const body = response.data;
    const userInfo = body?.data || null;
    const user = userInfo?.user || null;

    if (body?.code === 0 && user) {
      return {
        status: "authenticated",
        user,
        userInfo,
        loading: false,
      };
    }
  } catch {
    return anonymousAuthState;
  }

  return anonymousAuthState;
}

export function AppRuntimeProvider({ children }: { children: ReactNode }) {
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [serverConfigLoading, setServerConfigLoading] = useState(true);
  const [auth, setAuth] = useState<RuntimeAuthState>(initialAuthState);

  const reloadServerConfig = useCallback(async () => {
    setServerConfigLoading(true);
    const nextServerConfig = await requestServerConfig();
    setServerConfig(nextServerConfig);
    setServerConfigLoading(false);
    return nextServerConfig;
  }, []);

  const reloadAuth = useCallback(async () => {
    setAuth((current) => ({
      ...current,
      loading: true,
    }));
    const nextAuth = await requestAuthState();
    setAuth(nextAuth);
    return nextAuth;
  }, []);

  const reloadRuntime = useCallback(async () => {
    await Promise.allSettled([reloadServerConfig(), reloadAuth()]);
  }, [reloadAuth, reloadServerConfig]);

  useEffect(() => {
    void reloadRuntime();
  }, [reloadRuntime]);

  const value = useMemo<AppRuntimeContextValue>(
    () => ({
      serverConfig,
      serverConfigLoading,
      auth,
      reloadServerConfig,
      reloadAuth,
      reloadRuntime,
    }),
    [auth, reloadAuth, reloadRuntime, reloadServerConfig, serverConfig, serverConfigLoading],
  );

  return (
    <AppRuntimeContext.Provider value={value}>
      <DesktopEndpointBridge authenticated={auth.status === "authenticated"} />
      {children}
    </AppRuntimeContext.Provider>
  );
}

export function useAppRuntime() {
  const context = useContext(AppRuntimeContext);

  if (!context) {
    throw new Error("useAppRuntime must be used within AppRuntimeProvider");
  }

  return context;
}
