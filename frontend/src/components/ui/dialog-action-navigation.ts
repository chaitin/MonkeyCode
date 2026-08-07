import * as React from "react"

function useDialogActionNavigation() {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const confirmRef = React.useRef<HTMLButtonElement>(null)
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      cancelRef.current?.focus()
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      confirmRef.current?.focus()
    }
  }

  return { cancelRef, confirmRef, onKeyDown }
}

export { useDialogActionNavigation }
