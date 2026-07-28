export {};

declare global {
  interface Window {
    monkeyCodeDesktop?: {
      endpointBridge: {
        start: (baseUrl: string) => Promise<{ machine_id: string }>;
        stop: () => Promise<void>;
        send: (message: string) => Promise<void>;
        onMessage: (listener: (message: string) => void) => () => void;
        onClose: (listener: (detail: { code: number; reason: string }) => void) => () => void;
      };
    };
  }
}
