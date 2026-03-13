import React, { createContext, useContext, useState } from "react"

interface BreadcrumbTaskContextValue {
  taskName: string | null
  setTaskName: (name: string | null) => void
}

const BreadcrumbTaskContext = createContext<BreadcrumbTaskContextValue | null>(null)

export function BreadcrumbTaskProvider({ children }: { children: React.ReactNode }) {
  const [taskName, setTaskName] = useState<string | null>(null)
  return (
    <BreadcrumbTaskContext.Provider value={{ taskName, setTaskName }}>
      {children}
    </BreadcrumbTaskContext.Provider>
  )
}

export function useBreadcrumbTask() {
  const ctx = useContext(BreadcrumbTaskContext)
  return ctx
}
