import { app, BrowserWindow } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pkg from "electron-updater";

const { autoUpdater } = pkg;

const SETTINGS_FILE = "updater-settings.json";

const STAGES = {
  IDLE: "idle",
  CHECKING: "checking",
  AVAILABLE: "available",
  NOT_AVAILABLE: "not-available",
  DOWNLOADING: "downloading",
  DOWNLOADED: "downloaded",
  ERROR: "error",
  DISABLED: "disabled"
};

const DEFAULT_SETTINGS = {
  autoCheck: true,
  autoDownload: true
};

const PROGRESS_NOTIFY_INTERVAL_MS = 250;

let initialized = false;
let lastSettings = { ...DEFAULT_SETTINGS };
let lastProgressEmit = 0;
let state = {
  stage: STAGES.IDLE,
  message: "",
  currentVersion: "",
  availableVersion: "",
  releaseNotes: "",
  releaseName: "",
  releaseDate: "",
  progress: null,
  lastCheckedAt: "",
  lastError: "",
  enabled: true,
  autoCheck: DEFAULT_SETTINGS.autoCheck,
  autoDownload: DEFAULT_SETTINGS.autoDownload
};

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

async function loadSettings() {
  try {
    const raw = await readFile(getSettingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      autoCheck: typeof parsed.autoCheck === "boolean" ? parsed.autoCheck : DEFAULT_SETTINGS.autoCheck,
      autoDownload: typeof parsed.autoDownload === "boolean" ? parsed.autoDownload : DEFAULT_SETTINGS.autoDownload
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("[AiHub] failed to read updater settings:", error.message);
    }
    return { ...DEFAULT_SETTINGS };
  }
}

async function persistSettings(settings) {
  try {
    await mkdir(path.dirname(getSettingsPath()), { recursive: true });
    await writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    console.warn("[AiHub] failed to persist updater settings:", error.message);
  }
}

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function setState(patch) {
  state = { ...state, ...patch };
  broadcast("updater:state", cloneState());
}

function cloneState() {
  return { ...state, progress: state.progress ? { ...state.progress } : null };
}

function isUpdaterAvailable() {
  return Boolean(app.isPackaged);
}

export function getUpdaterState() {
  return cloneState();
}

export async function initializeUpdater() {
  if (initialized) {
    return cloneState();
  }
  initialized = true;

  state.currentVersion = app.getVersion();
  state.enabled = isUpdaterAvailable();

  lastSettings = await loadSettings();
  state.autoCheck = lastSettings.autoCheck;
  state.autoDownload = lastSettings.autoDownload;

  if (!isUpdaterAvailable()) {
    setState({ stage: STAGES.DISABLED, message: "开发模式下不会检查更新。" });
    return cloneState();
  }

  autoUpdater.autoDownload = lastSettings.autoDownload;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (...args) => console.info("[AiHub][updater]", ...args),
    warn: (...args) => console.warn("[AiHub][updater]", ...args),
    error: (...args) => console.error("[AiHub][updater]", ...args),
    debug: () => {}
  };

  autoUpdater.on("checking-for-update", () => {
    setState({ stage: STAGES.CHECKING, message: "正在检查更新…", lastError: "" });
  });

  autoUpdater.on("update-available", (info) => {
    setState({
      stage: STAGES.AVAILABLE,
      message: lastSettings.autoDownload ? "发现新版本，正在自动下载…" : "发现新版本",
      availableVersion: info?.version || "",
      releaseNotes: stringifyReleaseNotes(info?.releaseNotes),
      releaseName: info?.releaseName || "",
      releaseDate: info?.releaseDate || "",
      lastCheckedAt: new Date().toISOString()
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setState({
      stage: STAGES.NOT_AVAILABLE,
      message: "已经是最新版本",
      availableVersion: info?.version || state.currentVersion,
      releaseNotes: "",
      releaseName: "",
      releaseDate: info?.releaseDate || "",
      progress: null,
      lastCheckedAt: new Date().toISOString()
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const now = Date.now();
    const next = {
      percent: Number(progress?.percent || 0),
      transferred: Number(progress?.transferred || 0),
      total: Number(progress?.total || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0)
    };
    if (now - lastProgressEmit < PROGRESS_NOTIFY_INTERVAL_MS && next.percent < 100) {
      state.progress = next;
      return;
    }
    lastProgressEmit = now;
    setState({
      stage: STAGES.DOWNLOADING,
      message: `下载中 ${next.percent.toFixed(1)}%`,
      progress: next
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setState({
      stage: STAGES.DOWNLOADED,
      message: "新版本已下载完成，重启后安装。",
      availableVersion: info?.version || state.availableVersion,
      releaseNotes: stringifyReleaseNotes(info?.releaseNotes) || state.releaseNotes,
      releaseName: info?.releaseName || state.releaseName,
      releaseDate: info?.releaseDate || state.releaseDate,
      progress: { ...(state.progress || {}), percent: 100 }
    });
  });

  autoUpdater.on("error", (error) => {
    const message = error?.message || String(error);
    setState({
      stage: STAGES.ERROR,
      message: `更新失败：${message}`,
      lastError: message,
      progress: null
    });
  });

  if (lastSettings.autoCheck) {
    runCheck({ silent: true }).catch((error) => {
      console.warn("[AiHub] initial update check failed:", error?.message || error);
    });
  }

  return cloneState();
}

export async function checkForUpdates({ silent = false } = {}) {
  if (!initialized) {
    await initializeUpdater();
  }
  return runCheck({ silent });
}

async function runCheck({ silent }) {
  if (!isUpdaterAvailable()) {
    if (!silent) {
      setState({ stage: STAGES.DISABLED, message: "开发模式下无法检查更新。" });
    }
    return cloneState();
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (!silent) {
      const message = error?.message || String(error);
      setState({ stage: STAGES.ERROR, message: `更新失败：${message}`, lastError: message });
    } else {
      console.warn("[AiHub] silent update check failed:", error?.message || error);
    }
  }
  return cloneState();
}

export async function downloadUpdate() {
  if (!initialized) {
    await initializeUpdater();
  }
  if (!isUpdaterAvailable()) {
    throw new Error("开发模式下无法下载更新。");
  }
  if (state.stage === STAGES.DOWNLOADED) {
    return cloneState();
  }
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error?.message || String(error);
    setState({ stage: STAGES.ERROR, message: `下载失败：${message}`, lastError: message });
    throw error;
  }
  return cloneState();
}

export function quitAndInstall() {
  if (!isUpdaterAvailable()) {
    throw new Error("开发模式下无法安装更新。");
  }
  if (state.stage !== STAGES.DOWNLOADED) {
    throw new Error("没有可安装的更新。");
  }
  // isSilent=false: show installer UI on Windows; isForceRunAfter=true to relaunch.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}

export async function setUpdaterSettings(patch = {}) {
  if (!initialized) {
    await initializeUpdater();
  }
  const next = {
    autoCheck: typeof patch.autoCheck === "boolean" ? patch.autoCheck : lastSettings.autoCheck,
    autoDownload: typeof patch.autoDownload === "boolean" ? patch.autoDownload : lastSettings.autoDownload
  };
  lastSettings = next;
  await persistSettings(next);
  if (isUpdaterAvailable()) {
    autoUpdater.autoDownload = next.autoDownload;
  }
  setState({ autoCheck: next.autoCheck, autoDownload: next.autoDownload });
  return cloneState();
}

function stringifyReleaseNotes(notes) {
  if (!notes) {
    return "";
  }
  if (typeof notes === "string") {
    return notes;
  }
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (!entry) {
          return "";
        }
        if (typeof entry === "string") {
          return entry;
        }
        const version = entry.version ? `v${entry.version}` : "";
        const note = entry.note || "";
        return [version, note].filter(Boolean).join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return String(notes);
}
