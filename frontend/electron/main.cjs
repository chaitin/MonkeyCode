const { app, BrowserWindow, shell, dialog, Menu } = require("electron")
const fs = require("fs")
const path = require("path")

const isDev = !app.isPackaged
const DEFAULT_PROD_URL = "https://monkeycode-ai.com"

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
    const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173"
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: "detach" })
  } else if (process.env.MONKEYCODE_LOAD_LOCAL_DIST === "1") {
    const indexHtml = path.join(__dirname, "..", "dist", "index.html")
    if (!fs.existsSync(indexHtml)) {
      dialog.showErrorBox(
        "MonkeyCode",
        "未找到 dist/index.html。请先执行 ELECTRON=true pnpm build，或不要使用 MONKEYCODE_LOAD_LOCAL_DIST。"
      )
      app.quit()
      return
    }
    win.loadFile(indexHtml)
  } else {
    win.loadURL(process.env.MONKEYCODE_DESKTOP_URL || DEFAULT_PROD_URL)
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
