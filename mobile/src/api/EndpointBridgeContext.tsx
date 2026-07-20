import Constants from 'expo-constants';
import * as Device from 'expo-device';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import {
  EndpointBridgeClient,
  type EndpointConnectionState,
  type EndpointPlatform,
  type EndpointView,
} from './endpointBridge';
import { getOrCreateEndpointMachineId } from './endpointIdentity';

interface EndpointBridgeState {
  client: EndpointBridgeClient | null;
  state: EndpointConnectionState;
  endpoints: EndpointView[];
}

const EndpointBridgeContext = createContext<EndpointBridgeState>({
  client: null,
  state: 'idle',
  endpoints: [],
});

export function EndpointBridgeProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, baseUrl } = useAuth();
  const [client, setClient] = useState<EndpointBridgeClient | null>(null);
  const [state, setState] = useState<EndpointConnectionState>('idle');
  const [endpoints, setEndpoints] = useState<EndpointView[]>([]);

  useEffect(() => {
    if (!ready || !authenticated || Platform.OS === 'web') {
      setClient(null);
      setState('idle');
      setEndpoints([]);
      return;
    }
    let cancelled = false;
    let active: EndpointBridgeClient | null = null;
    void getOrCreateEndpointMachineId().then((machineId) => {
      if (cancelled) return;
      const platform = Platform.OS as EndpointPlatform;
      active = new EndpointBridgeClient({
        machineId,
        profile: {
          device_name: Device.deviceName || Device.modelName || `${platform} 端点`,
          platform,
          os_version: String(Platform.Version),
          arch: Device.supportedCpuArchitectures?.join(',') || 'unknown',
          client_version: Constants.expoConfig?.version || 'unknown',
        },
        onState: setState,
        onDirectory: setEndpoints,
      });
      setClient(active);
      active.connect();
    }).catch(() => {
      if (!cancelled) setState('stopped');
    });
    return () => {
      cancelled = true;
      active?.disconnect();
      setClient(null);
      setEndpoints([]);
    };
  }, [ready, authenticated, baseUrl]);

  const value = useMemo(() => ({ client, state, endpoints }), [client, state, endpoints]);
  return <EndpointBridgeContext.Provider value={value}>{children}</EndpointBridgeContext.Provider>;
}

export function useEndpointBridge(): EndpointBridgeState {
  return useContext(EndpointBridgeContext);
}
