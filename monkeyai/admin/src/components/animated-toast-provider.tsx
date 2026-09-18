import { createContext, type ReactNode, useContext, useMemo } from "react"

import {
  AnimatedToastStack,
  type ToastInput,
  useAnimatedToastStack,
} from "@/components/motion/animated-toast-stack"

type AnimatedToastContextValue = {
  showToast: (toast: ToastInput) => string
}

const AnimatedToastContext = createContext<AnimatedToastContextValue | null>(
  null
)

export function AnimatedToastProvider({ children }: { children: ReactNode }) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({
    defaultDuration: 4200,
    limit: 5,
  })
  const contextValue = useMemo(() => ({ showToast }), [showToast])

  return (
    <AnimatedToastContext.Provider value={contextValue}>
      {children}
      <AnimatedToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        placement="fixed"
        maxVisible={4}
      />
    </AnimatedToastContext.Provider>
  )
}

// Keep the provider and its hook together so the context remains private.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppToast() {
  const context = useContext(AnimatedToastContext)

  if (!context) {
    throw new Error("useAppToast must be used within AnimatedToastProvider")
  }

  return context
}
