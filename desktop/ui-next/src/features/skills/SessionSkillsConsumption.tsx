import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

interface ConsumerState {
  sessionId: string;
  revision: number;
}

/** 只协调现有 App 会话状态与已挂载 Composer 的消费屏障，不保存第二份会话数据。 */
export class SessionSkillsConsumptionCoordinator {
  private consumers = new Map<symbol, ConsumerState>();
  private waiters = new Set<() => void>();

  register(token: symbol, sessionId: string, revision: number): void {
    this.consumers.set(token, { sessionId, revision });
    this.notify();
  }

  unregister(token: symbol): void {
    this.consumers.delete(token);
    this.notify();
  }

  waitFor(revisions: ReadonlyMap<string, number>): Promise<void> {
    if (this.hasConsumed(revisions)) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (!this.hasConsumed(revisions)) return;
        this.waiters.delete(check);
        resolve();
      };
      this.waiters.add(check);
    });
  }

  private hasConsumed(revisions: ReadonlyMap<string, number>): boolean {
    for (const consumer of this.consumers.values()) {
      const target = revisions.get(consumer.sessionId);
      if (target !== undefined && consumer.revision < target) return false;
    }
    return true;
  }

  private notify(): void {
    for (const check of [...this.waiters]) check();
  }
}

const SessionSkillsConsumptionContext = createContext<SessionSkillsConsumptionCoordinator | null>(null);

export function SessionSkillsConsumptionProvider({
  coordinator,
  children,
}: {
  coordinator: SessionSkillsConsumptionCoordinator;
  children: ReactNode;
}) {
  return (
    <SessionSkillsConsumptionContext.Provider value={coordinator}>
      {children}
    </SessionSkillsConsumptionContext.Provider>
  );
}

/** Composer 在本地状态真正接受 server revision 后报告；卸载会解除等待。 */
export function useReportConsumedSessionSkills(sessionId: string, revision: number): void {
  const coordinator = useContext(SessionSkillsConsumptionContext);
  const tokenRef = useRef(Symbol("session-skills-consumer"));
  useEffect(() => {
    if (!coordinator) return;
    const token = tokenRef.current;
    coordinator.register(token, sessionId, revision);
    return () => coordinator.unregister(token);
  }, [coordinator, sessionId, revision]);
}
