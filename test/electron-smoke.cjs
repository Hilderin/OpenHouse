// Electron smoke test: boots the real OpenHouse core in-process, renders the UI,
// captures a screenshot and exits. Run with:
//   DISPLAY=:0 OPENHOUSE_OPENCODE_BIN=<bin> node_modules/electron/dist/electron test/electron-smoke.cjs --no-sandbox
const { app, BrowserWindow } = require("electron")
const fs = require("node:fs")
const path = require("node:path")

const bundle = require("/tmp/opencode/oh-core-bundle.cjs")
const { startCore, loadConfig } = bundle

async function main() {
  const dataDir = "/tmp/opencode/oh-electron-data"
  const core = await startCore(
    loadConfig({
      port: 7820,
      dataDir,
      uiDist: path.resolve(__dirname, "..", "ui", "dist"),
      opencodeBin: process.env.OPENHOUSE_OPENCODE_BIN,
    }),
  )
  try {
    await fetch(`${core.url}/api/oh/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/tmp/opencode/oh-testproj", name: "Test Project" }),
    }).catch(() => {})
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      show: true,
      backgroundColor: "#0f1115",
      title: "OpenHouse",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    await win.loadURL(core.url)
    await new Promise((r) => setTimeout(r, 4000))
    const img = await win.webContents.capturePage()
    fs.writeFileSync("/tmp/opencode/electron-smoke.png", img.toPNG())
    console.log("ELECTRON_OK", core.url)
  } finally {
    await core.stop()
    app.quit()
  }
}

app.whenReady().then(main).catch((err) => {
  console.error("ELECTRON_FAIL", err)
  app.exit(1)
})
