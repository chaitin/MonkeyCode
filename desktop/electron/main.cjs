const { app, BrowserWindow, shell, dialog, Menu } = require("electron")
const fs = require("fs")
const path = require("path")

const isDev = !app.isPackaged
const DEFAULT_PROD_URL = "https://monkeycode-ai.com"
/** 桌面端启动路径（相对站点根），可用 MONKEYCODE_DESKTOP_START_PATH 覆盖 */
const START_PATH = (process.env.MONKEYCODE_DESKTOP_START_PATH || "/console/").replace(/\/$/, "") || "/console"

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
    createWindow()
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
