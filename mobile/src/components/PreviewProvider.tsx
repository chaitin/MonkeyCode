/**
 * 全局在线预览：把 PreviewBrowser 挂在导航器之上（App 根），这样：
 *   - 收起后切到首页 / 别的页面再回来，预览不会被销毁（WebView 一直存活，展开秒回）；
 *   - 一个时刻只保留一个预览（taskId 标记归属，便于任务详情判断是不是“自己的”预览）。
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { View } from 'react-native';
import { PreviewBrowser } from '@/components/PreviewBrowser';

type PreviewState = { url: string; taskId: string; minimized: boolean } | null;

interface PreviewApi {
  preview: PreviewState;
  open: (url: string, taskId: string) => void; // 打开（或切换 URL）并展开
  expand: () => void;
  minimize: () => void;
  close: () => void;
}

const Ctx = createContext<PreviewApi | null>(null);

export function PreviewProvider({ children }: { children: React.ReactNode }) {
  const [preview, setPreview] = useState<PreviewState>(null);
  const open = useCallback((url: string, taskId: string) => setPreview({ url, taskId, minimized: false }), []);
  const expand = useCallback(() => setPreview((p) => (p ? { ...p, minimized: false } : p)), []);
  const minimize = useCallback(() => setPreview((p) => (p ? { ...p, minimized: true } : p)), []);
  const close = useCallback(() => setPreview(null), []);
  const value = useMemo<PreviewApi>(() => ({ preview, open, expand, minimize, close }), [preview, open, expand, minimize, close]);

  return (
    <Ctx.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        <PreviewBrowser url={preview?.url ?? null} minimized={preview?.minimized ?? false} onMinimize={minimize} onClose={close} />
      </View>
    </Ctx.Provider>
  );
}

export function usePreview(): PreviewApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePreview must be used within PreviewProvider');
  return c;
}
