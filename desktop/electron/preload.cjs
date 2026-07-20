"use strict"
const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("monkeyCodeDesktop", {
  endpointBridge: {
    start: (baseUrl) => ipcRenderer.invoke("endpoint-bridge-start", baseUrl),
    stop: () => ipcRenderer.invoke("endpoint-bridge-stop"),
    send: (message) => ipcRenderer.invoke("endpoint-bridge-send", message),
    onMessage: (listener) => {
      const callback = (_event, message) => listener(message)
      ipcRenderer.on("endpoint-bridge-message", callback)
      return () => ipcRenderer.removeListener("endpoint-bridge-message", callback)
    },
    onClose: (listener) => {
      const callback = (_event, detail) => listener(detail)
      ipcRenderer.on("endpoint-bridge-close", callback)
      return () => ipcRenderer.removeListener("endpoint-bridge-close", callback)
    },
  },
})
