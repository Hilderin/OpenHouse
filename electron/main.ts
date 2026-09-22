import { BrowserWindow, app, shell } from "electron"
import { loadConfig } from "../src/core/config"
import { startCore, type CoreHandle } from "../src/server/start"

let core: CoreHandle | undefined
let win: BrowserWindow | undefined

async function createWindow(): Promise<void> {
  core = await startCore(loadConfig({}))
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    show: false,
    backgroundColor: "#0f1115",
    title: "OpenHouse",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once("ready-to-show", () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })
  await win.loadURL(core.url)
}

app.whenReady().then(createWindow).catch((err) => {
  console.error("failed to start OpenHouse:", err)
  app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on("window-all-closed", () => {
  void (async () => {
    await core?.stop()
    app.quit()
  })()
})
