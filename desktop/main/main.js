import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { stopManagedService } from "./service-controller.js";
import { initializeUpdater } from "./updater-controller.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

// Background colors must mirror the renderer's --background token (light/dark).
const BACKGROUND_LIGHT = "#f3f6fa";
const BACKGROUND_DARK = "#11151c";

let themeFilePath = null;

function getThemeFilePath() {
  if (!themeFilePath) {
    themeFilePath = path.join(app.getPath("userData"), "theme.txt");
  }
  return themeFilePath;
}

async function readStoredTheme() {
  try {
    const raw = await readFile(getThemeFilePath(), "utf8");
    const trimmed = raw.trim();
    if (trimmed === "light" || trimmed === "dark") {
      return trimmed;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("[AiHub] failed to read theme file:", error.message);
    }
  }
  return null;
}

async function writeStoredTheme(theme) {
  if (theme !== "light" && theme !== "dark") {
    return;
  }
  try {
    await mkdir(path.dirname(getThemeFilePath()), { recursive: true });
    await writeFile(getThemeFilePath(), theme, "utf8");
  } catch (error) {
    console.warn("[AiHub] failed to persist theme:", error.message);
  }
}

async function resolveStartupTheme() {
  const stored = await readStoredTheme();
  if (stored) {
    return stored;
  }
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

registerIpcHandlers({ persistTheme: writeStoredTheme });

async function createWindow() {
  const theme = await resolveStartupTheme();
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "AiHub",
    backgroundColor: theme === "dark" ? BACKGROUND_DARK : BACKGROUND_LIGHT,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--aihub-initial-theme=${theme}`]
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:5173");
  } else {
    await window.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  await createWindow();
  initializeUpdater().catch((error) => {
    console.warn("[AiHub] failed to initialize updater:", error?.message || error);
  });
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", async () => {
  await stopManagedService();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
