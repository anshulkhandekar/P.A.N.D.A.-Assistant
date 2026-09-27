const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pandaDesktop", {
  showOverlay: () => ipcRenderer.send("panda:show"),
  resizePanda: (delta) => ipcRenderer.send("panda:resize", delta),
  layoutOverlay: (width, height) =>
    ipcRenderer.send("panda:layout", width, height),
  setHitRegions: (regions) => ipcRenderer.send("panda:hit-regions", regions),
  onResizePanda: (callback) => {
    const listener = (_event, delta) => callback(delta);
    ipcRenderer.on("panda:resize", listener);
    return () => ipcRenderer.removeListener("panda:resize", listener);
  },
  moveDisplay: () => ipcRenderer.send("panda:move"),
  toggleOverlay: () => ipcRenderer.send("panda:toggle"),
});
