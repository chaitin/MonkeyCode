import { createContext, useContext, type ReactNode } from "react";

import type { SettingsSection } from "./SettingsView";

export interface SettingsNavigation {
  openSettings: (section?: SettingsSection) => void;
}

const NOOP_NAVIGATION: SettingsNavigation = { openSettings: () => {} };
const SettingsNavigationContext = createContext<SettingsNavigation>(NOOP_NAVIGATION);

export function SettingsNavigationProvider({
  openSettings,
  children,
}: SettingsNavigation & { children: ReactNode }) {
  return (
    <SettingsNavigationContext.Provider value={{ openSettings }}>
      {children}
    </SettingsNavigationContext.Provider>
  );
}

/** 工作台子组件可直接精确打开设置分区；独立渲染时入口保持无害可用。 */
export function useSettingsNavigation(): SettingsNavigation {
  return useContext(SettingsNavigationContext);
}
