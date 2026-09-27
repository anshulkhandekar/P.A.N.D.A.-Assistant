const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  dialog,
} = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
require("dotenv").config({ quiet: true });
// Optional isolated profile for local UI testing alongside the workshop app.
if (process.env.PANDA_DESKTOP_PROFILE)
  app.setPath("userData", path.resolve(process.env.PANDA_DESKTOP_PROFILE));
const port = Number(process.env.PORT || 3001);
const base = `http://127.0.0.1:${port}`;
let control,
  overlay,
  server,
  displayIndex = 0,
  hitRegions = [],
  hitTimer;
const preload = path.join(__dirname, "preload.cjs");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    control?.show();
    control?.focus();
  });
  app.whenReady().then(async () => {
    try {
      // Local development build: reuse a server if one is already running.
      let existing = false;
      try {
        existing = (await fetch(base + "/api/workshop/status")).ok;
      } catch {}
      if (!existing) {
        server = spawn(
          "node",
          [path.join(__dirname, "../dist/server/src/index.js")],
          {
            cwd: path.join(__dirname, ".."),
            env: process.env,
            stdio: "ignore",
          },
        );
        let failure = false;
        server.on("error", () => {
          failure = true;
        });
        let ready = false;
        for (let i = 0; i < 60; i++) {
          if (failure) break;
          try {
            if ((await fetch(base + "/api/workshop/status")).ok) {
              ready = true;
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!ready)
          throw Error(
            "Local server did not start. Run npm run build, then npm start in a terminal to see the error.",
          );
      }
      const prefs = {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      };
      control = new BrowserWindow({
        width: 1120,
        height: 850,
        title: "Panda Admin Panel",
        webPreferences: prefs,
      });
      overlay = new BrowserWindow({
        width: 340,
        height: 310,
        backgroundColor: "#00000000",
        frame: false,
        transparent: true,
        resizable: false,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
          ...prefs,
          backgroundThrottling: false,
          autoplayPolicy: "no-user-gesture-required",
        },
      });
      overlay.setAlwaysOnTop(true, "screen-saver");
      if (process.platform === "darwin")
        overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      const position = () => {
        const displays = screen.getAllDisplays();
        displayIndex %= displays.length;
        const b = displays[displayIndex].workArea;
        const size = overlay.getBounds();
        overlay.setPosition(
          b.x + b.width - size.width - 20,
          b.y + b.height - size.height - 20,
        );
      };
      position();
      screen.on("display-removed", position);
      screen.on("display-metrics-changed", position);
      for (const win of [control, overlay]) {
        win.webContents.setWindowOpenHandler(({ url }) =>
          url === base + "/admin"
            ? {
                action: "allow",
                overrideBrowserWindowOptions: {
                  webPreferences: {
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: true,
                  },
                },
              }
            : { action: "deny" },
        );
        win.webContents.on("will-navigate", (e, url) => {
          if (!url.startsWith(base + "/")) e.preventDefault();
        });
      }
      const valid = (e) =>
        [control?.webContents, overlay?.webContents].includes(e.sender);
      ipcMain.on("panda:show", (e) => {
        if (valid(e)) {
          overlay.setFocusable(true);
          overlay.show();
        }
      });
      ipcMain.on("panda:resize", (e, delta) => {
        if (valid(e) && Number.isFinite(delta))
          overlay.webContents.send(
            "panda:resize",
            Math.max(-40, Math.min(40, delta)),
          );
      });
      ipcMain.on("panda:layout", (e, width, height) => {
        if (
          e.sender !== overlay.webContents ||
          !Number.isFinite(width) ||
          !Number.isFinite(height)
        )
          return;
        const old = overlay.getBounds();
        const area = screen.getDisplayMatching(old).workArea;
        width = Math.round(
          Math.min(area.width, Math.max(180, Math.min(600, width))),
        );
        height = Math.round(
          Math.min(area.height, Math.max(180, Math.min(1000, height))),
        );
        if (width === old.width && height === old.height) return;
        const x = Math.round(
          Math.max(
            area.x,
            Math.min(
              area.x + area.width - width,
              old.x + (old.width - width) / 2,
            ),
          ),
        );
        const y = Math.round(
          Math.max(
            area.y,
            Math.min(
              area.y + area.height - height,
              old.y + old.height - height,
            ),
          ),
        );
        overlay.setBounds({ x, y, width, height });
      });
      ipcMain.on("panda:hit-regions", (e, areas) => {
        if (e.sender !== overlay.webContents || !Array.isArray(areas)) return;
        hitRegions = areas
          .slice(0, 30)
          .filter(
            (r) =>
              r &&
              [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
              r.width > 0 &&
              r.height > 0,
          );
      });
      // Transparent space passes clicks through; Panda and its controls remain interactive.
      let ignoring = false;
      hitTimer = setInterval(() => {
        if (!overlay || overlay.isDestroyed()) return;
        const p = screen.getCursorScreenPoint(),
          b = overlay.getBounds();
        const hit = hitRegions.some(
          (r) =>
            p.x >= b.x + r.x &&
            p.x <= b.x + r.x + r.width &&
            p.y >= b.y + r.y &&
            p.y <= b.y + r.y + r.height,
        );
        if (ignoring === hit) {
          ignoring = !hit;
          overlay.setIgnoreMouseEvents(ignoring, { forward: true });
        }
      }, 50);
      ipcMain.on("panda:move", (e) => {
        if (valid(e)) {
          displayIndex++;
          position();
        }
      });
      const toggle = () =>
        overlay.isVisible() ? overlay.hide() : overlay.showInactive();
      ipcMain.on("panda:toggle", (e) => {
        if (valid(e)) toggle();
      });
      globalShortcut.register("CommandOrControl+Shift+P", toggle);
      globalShortcut.register("CommandOrControl+Shift+O", () => {
        control.show();
        control.focus();
      });
      control.on("closed", () => app.quit());
      await control.loadURL(base + "/workshop");
      await overlay.loadURL(base + "/overlay");
    } catch (e) {
      dialog.showErrorBox("P.A.N.D.A. could not start", e.message);
      app.quit();
    }
  });
  app.on("will-quit", () => {
    clearInterval(hitTimer);
    globalShortcut.unregisterAll();
    server?.kill("SIGTERM");
  });
  app.on("window-all-closed", () => app.quit());
}
