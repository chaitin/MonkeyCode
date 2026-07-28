const { app, BrowserWindow, shell, dialog, Menu, ipcMain, safeStorage } = require("electron")
const { randomUUID } = require("crypto")
const fs = require("fs")
const os = require("os")
const path = require("path")
const WebSocket = require("ws")

const isDev = !app.isPackaged
const DEFAULT_PROD_URL = "https://monkeycode-ai.com"
const ERR_ABORTED = -3
/** 桌面端启动路径（相对站点根），可用 MONKEYCODE_DESKTOP_START_PATH 覆盖 */
const START_PATH = (process.env.MONKEYCODE_DESKTOP_START_PATH || "/console/").replace(/\/$/, "") || "/console"
const ENDPOINT_MAX_FRAME_BYTES = 256 * 1024
const endpointConnections = new Map()

function desktopEntryUrl(base) {
  const href = (base || "").trim() || DEFAULT_PROD_URL
  return new URL(`${START_PATH.startsWith("/") ? START_PATH : `/${START_PATH}`}`, href).href
}

/** 开发 / 源码运行：前端构建产物在仓库 frontend/dist；安装包内为 web-dist */
function localDistIndexHtml() {
  if (app.isPackaged) {
    return path.join(__dirname, "..", "web-dist", "index.html")
  }
  return path.join(__dirname, "..", "..", "frontend", "dist", "index.html")
}

/** Windows 任务栏/窗口图标不能从 app.asar 内读，需配合 package.json 的 asarUnpack */
function windowIconPath() {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "electron", "icon.png")
    if (fs.existsSync(unpacked)) return unpacked
  }
  const local = path.join(__dirname, "icon.png")
  return fs.existsSync(local) ? local : undefined
}

/** 避免 ready-to-show 迟迟不触发时窗口永远隐藏（用户以为程序没启动） */
function ensureWindowVisible(win, ms = 2000) {
  const show = () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.once("ready-to-show", show)
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed() && !win.isVisible()) show()
  })
  setTimeout(show, ms)
}

function isBenignLoadFailure(code, desc) {
  return code === ERR_ABORTED || desc === "ERR_ABORTED"
}

function endpointIdentityPath() {
  return path.join(app.getPath("userData"), "endpoint-machine-id")
}

function endpointMachineId() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("操作系统安全存储不可用")
  }
  const filename = endpointIdentityPath()
  try {
    const encrypted = fs.readFileSync(filename)
    const machineId = safeStorage.decryptString(encrypted)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(machineId)) {
      return machineId
    }
  } catch {
    // 首次安装或本地安全存储已失效时生成新标识。
  }
  const machineId = randomUUID()
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, safeStorage.encryptString(machineId), { mode: 0o600 })
  return machineId
}

function endpointBaseUrl(sender, requested) {
  const senderUrl = new URL(sender.getURL())
  if (senderUrl.protocol === "http:" || senderUrl.protocol === "https:") {
    const base = new URL(requested || senderUrl.origin)
    if (base.origin !== senderUrl.origin) throw new Error("桥接地址必须与客户端页面同源")
    return base
  }
  const configured = new URL(process.env.MONKEYCODE_DESKTOP_URL || DEFAULT_PROD_URL)
  if (requested && new URL(requested).origin !== configured.origin) {
    throw new Error("桥接地址不受信任")
  }
  return configured
}

async function startEndpointBridge(event, requestedBaseUrl) {
  const sender = event.sender
  stopEndpointBridge(sender.id)
  const base = endpointBaseUrl(sender, requestedBaseUrl)
  const entry = {
    sender,
    base,
    socket: null,
    timer: null,
    attempt: 0,
    stableSince: 0,
    stopped: false,
  }
  endpointConnections.set(sender.id, entry)
  try {
    await connectEndpointBridge(entry)
  } catch (error) {
    stopEndpointBridge(sender.id)
    throw error
  }
  return { machine_id: endpointMachineId() }
}

async function connectEndpointBridge(entry) {
  if (entry.stopped || entry.sender.isDestroyed()) return
  const { sender, base } = entry
  const cookies = await sender.session.cookies.get({ url: base.origin })
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
  const wsUrl = new URL("/api/v1/endpoints/connect", base)
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:"
  const socket = new WebSocket(wsUrl, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
    maxPayload: ENDPOINT_MAX_FRAME_BYTES,
    perMessageDeflate: false,
  })
  entry.socket = socket
  socket.on("open", () => {
    if (entry.stopped || entry.socket !== socket) return
    entry.stableSince = Date.now()
    const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform
    socket.send(JSON.stringify({
      type: "hello",
      protocol_versions: [1],
      machine_id: endpointMachineId(),
      profile: {
        device_name: os.hostname(),
        platform,
        os_version: os.release(),
        arch: process.arch,
        client_version: app.getVersion(),
      },
    }))
  })
  socket.on("message", (data, isBinary) => {
    if (isBinary || data.byteLength > ENDPOINT_MAX_FRAME_BYTES || sender.isDestroyed()) return
    sender.send("endpoint-bridge-message", data.toString("utf8"))
  })
  socket.on("close", (code, reason) => {
    if (entry.socket === socket) entry.socket = null
    if (!sender.isDestroyed()) {
      sender.send("endpoint-bridge-close", { code, reason: reason.toString("utf8") })
    }
    if (entry.stopped || ![1006, 1011, 1012, 1013].includes(code)) return
    if (entry.stableSince > 0 && Date.now() - entry.stableSince >= 60_000) entry.attempt = 0
    const delays = [500, 1000, 2000, 4000, 8000, 16_000, 30_000]
    const baseDelay = delays[Math.min(entry.attempt, delays.length - 1)]
    entry.attempt += 1
    entry.timer = setTimeout(() => {
      entry.timer = null
      void connectEndpointBridge(entry).catch((error) => {
        if (!sender.isDestroyed()) sender.send("endpoint-bridge-error", error.message)
      })
    }, Math.round(baseDelay * (0.8 + Math.random() * 0.4)))
  })
  socket.on("error", (error) => {
    if (!sender.isDestroyed()) sender.send("endpoint-bridge-error", error.message)
  })
}

function stopEndpointBridge(senderId) {
  const entry = endpointConnections.get(senderId)
  if (!entry) return
  endpointConnections.delete(senderId)
  entry.stopped = true
  if (entry.timer) clearTimeout(entry.timer)
  entry.socket?.close(1000, "client stopped")
}

function sendEndpointMessage(event, message) {
  const entry = endpointConnections.get(event.sender.id)
  if (!entry?.socket || entry.socket.readyState !== WebSocket.OPEN) throw new Error("端点桥接连接尚未就绪")
  if (typeof message !== "string" || Buffer.byteLength(message, "utf8") > ENDPOINT_MAX_FRAME_BYTES) {
    throw new Error("端点消息无效或超过大小限制")
  }
  const envelope = JSON.parse(message)
  if (!["event", "request", "response"].includes(envelope?.type)) {
    throw new Error("端点消息类型无效")
  }
  entry.socket.send(message)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    icon: windowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // 加载完整 Web 应用时 sandbox 可能导致部分站点行为异常，桌面壳使用非沙箱更稳妥
      sandbox: false,
    },
  })

  ensureWindowVisible(win, 2000)

  win.webContents.on("did-fail-load", (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return
    if (isBenignLoadFailure(code, desc)) return
    if (!win.isDestroyed() && !win.isVisible()) win.show()
    if (isDev) return
    dialog.showErrorBox(
      "MonkeyCode",
      `页面加载失败（${code}）\n${desc}\n\n${url}\n\n请检查网络或代理；也可设置环境变量 MONKEYCODE_DESKTOP_URL 指向可访问的地址。`
    )
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  if (isDev) {
    const devBase = process.env.VITE_DEV_SERVER_URL || "http://localhost:11180"
    win.loadURL(desktopEntryUrl(devBase))
    win.webContents.openDevTools({ mode: "detach" })
  } else if (process.env.MONKEYCODE_LOAD_LOCAL_DIST === "1") {
    const indexHtml = localDistIndexHtml()
    if (!fs.existsSync(indexHtml)) {
      dialog.showErrorBox(
        "MonkeyCode",
        "未找到本地前端构建。请先于仓库根执行：cd desktop && pnpm electron:build:dist（或先 pnpm electron:sync-web 再打安装包），或不要使用 MONKEYCODE_LOAD_LOCAL_DIST。"
      )
      app.quit()
      return
    }
    win.loadFile(indexHtml)
  } else {
    const base = process.env.MONKEYCODE_DESKTOP_URL || DEFAULT_PROD_URL
    win.loadURL(desktopEntryUrl(base))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

  app.whenReady().then(() => {
    // Windows / Linux：去掉顶部「文件、编辑…」应用菜单栏
    if (process.platform !== "darwin") {
      Menu.setApplicationMenu(null)
    } else {
      const icon = windowIconPath()
      if (icon) app.dock.setIcon(icon)
    }
    ipcMain.handle("endpoint-bridge-start", startEndpointBridge)
    ipcMain.handle("endpoint-bridge-stop", (event) => stopEndpointBridge(event.sender.id))
    ipcMain.handle("endpoint-bridge-send", sendEndpointMessage)
    createWindow()
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("web-contents-created", (_event, contents) => {
  contents.once("destroyed", () => stopEndpointBridge(contents.id))
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
